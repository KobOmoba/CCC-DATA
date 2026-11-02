// CCC Parish Portal - Phase 8: shared alert + rollup logic (totals only, never names of people).
// One file, used by BOTH the browser (classic <script>, Super Admin fallback) and the scheduled Cloudflare Worker
// (ccc-ai, imported as a side-effect module). It only defines globalThis.AlertsCore: pure functions, no I/O.
(() => {
    const CAT_KEYS = ["tithes", "offerings", "thanksgiving", "harvest", "building", "other"];
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
    const money = (cur, x) => `${cur || ""} ${r2(x).toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
    const addMonths = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
    const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const monthName = m => { const [y, mo] = m.split("-").map(Number); return `${MONTHS[mo - 1]} ${y}`; };
    const totalIncome = inc => r2(CAT_KEYS.reduce((t, k) => t + ((inc || {})[k] || 0), 0));
    const slug = v => String(v || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";

    const RULE_NAMES = {
        underpaid: "Remitted less than due, 2+ months", titheDrop: "Tithes down 30%+ (attendance steady)", notFiled: "No return by the 10th",
        bigChange: "Big one-off change", attendanceDrop: "Attendance down 30%+", memberDecline: "Membership down 10%+ in 3 months",
        inactive: "No activity for 30 days", returnsGap: "No return in 2 of the last 3 months"
    };

    // Phase 6 checks (moved here so the server job and the browser share them). Month m = the returns month.
    // returnsByParish: { parishId: { 'YYYY-MM': return } }. parishes: [{ id, name, status, currency, createdAt }].
    function returnAlerts(m, parishes, returnsByParish, today) {
        const out = [];
        const prev = Array.from({ length: 6 }, (_, i) => addMonths(m, -(i + 1)));
        const deadline = addMonths(m, 1) + "-10";
        for (const p of parishes) {
            if (p.status !== "Approved") continue;
            const rs = returnsByParish[p.id] || {}, r = rs[m];
            const add = (rule, detail) => out.push({ parishId: p.id, parishName: p.name || p.id, rule, detail, currency: (r && r.currency) || p.currency || "" });
            // Returns gap: 2+ of the last 3 months (from the parish's first full month) have no return.
            const since = String(p.createdAt || "").slice(0, 7);
            const last3 = [m, addMonths(m, -1), addMonths(m, -2)].filter(x => !since || x > since);
            const missing = last3.filter(x => !rs[x]).length;
            if (last3.length === 3 && missing >= 2 && today > deadline) add("returnsGap", `No return for ${missing} of the last 3 months (to ${monthName(m)}).`);
            if (!r) { if (today > deadline) add("notFiled", `No return for ${monthName(m)} by ${deadline}.`); continue; }
            const r1 = rs[addMonths(m, -1)];
            if (r.outstanding > 0.005 && r1 && r1.outstanding > 0.005)
                add("underpaid", `Short ${money(r.currency, r.outstanding)} this month and ${money(r1.currency, r1.outstanding)} last month.`);
            const hist = prev.map(x => rs[x]).filter(Boolean);
            if (hist.length >= 3) {
                const avg = f => hist.reduce((t, x) => t + f(x), 0) / hist.length;
                const avgT = avg(x => x.income.tithes), avgA = avg(x => x.attendance), avgI = avg(x => totalIncome(x.income));
                if (avgT > 0 && r.income.tithes < 0.7 * avgT && r.attendance >= 0.9 * avgA)
                    add("titheDrop", `Tithes ${money(r.currency, r.income.tithes)} vs 6-month average ${money(r.currency, avgT)} (${Math.round(100 - 100 * r.income.tithes / avgT)}% down); attendance ${r.attendance} vs ${Math.round(avgA)}.`);
                const ti = totalIncome(r.income);
                if (avgI > 0 && (ti > 2 * avgI || ti < 0.5 * avgI))
                    add("bigChange", `Total income ${money(r.currency, ti)} vs 6-month average ${money(r.currency, avgI)}.`);
            }
        }
        return out;
    }

    // Month-end snapshot of one parish (cumulative counters from parishStats; no names).
    function snapshot(p, st, m, nowIso) {
        st = st || {};
        return { parishId: p.id, month: m, memberCount: st.memberCount || 0, clergyCount: st.clergyCount || 0,
            attendanceTotal: st.attendanceTotal || 0, serviceCount: st.serviceCount || 0, birthCount: st.birthCount || 0,
            deathCount: st.deathCount || 0, lastActive: st.lastActive || "", city: p.city || "", country: p.country || "",
            continent: p.continent || "", updatedAt: nowIso };
    }
    // Attendance in month x = growth of the cumulative attendance counter between two month-end snapshots.
    const monthAtt = (sn, x) => sn[x] && sn[addMonths(x, -1)] ? Math.max(0, sn[x].attendanceTotal - sn[addMonths(x, -1)].attendanceTotal) : null;

    // New checks. m = the current month (YYYY-MM); snaps = { parishId: { 'YYYY-MM': snapshot } } incl. month m.
    function statsAlerts(m, parishes, snaps, today) {
        const out = [];
        for (const p of parishes) {
            if (p.status !== "Approved") continue;
            const sn = snaps[p.id] || {}, cur = sn[m];
            const add = (rule, detail) => out.push({ parishId: p.id, parishName: p.name || p.id, rule, detail, currency: p.currency || "" });
            const last = addMonths(m, -1), a = monthAtt(sn, last);
            const prev = [2, 3, 4].map(i => monthAtt(sn, addMonths(m, -i))).filter(x => x !== null);
            if (a !== null && prev.length >= 2) {
                const avg = prev.reduce((t, x) => t + x, 0) / prev.length;
                if (avg >= 20 && a < 0.7 * avg) add("attendanceDrop", `Attendance in ${monthName(last)} was ${a} vs ${Math.round(avg)} a month before (${Math.round(100 - 100 * a / avg)}% down).`);
            }
            const old = sn[addMonths(m, -3)] || sn[addMonths(m, -2)];
            if (cur && old && old.memberCount > 0) {
                const drop = old.memberCount - cur.memberCount;
                if (drop >= 5 && drop >= 0.1 * old.memberCount)
                    add("memberDecline", `Members ${cur.memberCount} now vs ${old.memberCount} in ${monthName(old.month)} (${Math.round(100 * drop / old.memberCount)}% down).`);
            }
            const created = String(p.createdAt || "").slice(0, 10), act = (cur && cur.lastActive) || "";
            const cutoff = addDays(today, -30);
            if ((act ? act < cutoff : (created && created < cutoff)))
                add("inactive", act ? `Last activity ${act} (over 30 days).` : `No activity recorded since the parish was created (${created}).`);
        }
        return out;
    }

    // Rollups for the AI dashboard: world / continent / country / city, for month m. prev = snapshots of month m-1.
    function rollups(m, parishes, now, prev, filed, nowIso) {
        const agg = {};
        for (const p of parishes) {
            const s = now[p.id]; if (!s) continue;
            const b = prev[p.id];
            const keys = [{ level: "world", key: "all", name: "World" }, { level: "continent", key: slug(p.continent), name: p.continent || "Unknown continent" },
                { level: "country", key: slug(p.country), name: p.country || "Unknown country" },
                { level: "city", key: slug(p.country) + "--" + slug(p.city), name: p.city || "Unknown city" }];
            for (const k of keys) {
                const id = `${m}_${k.level}_${k.key}`;
                const a = agg[id] ||= { month: m, level: k.level, key: k.key, name: k.name, country: k.level === "city" ? p.country || "" : "", continent: k.level === "country" ? p.continent || "" : "",
                    parishes: 0, members: 0, clergy: 0, attendance: 0, births: 0, deaths: 0, birthsMonth: 0, deathsMonth: 0, returnsFiled: 0, updatedAt: nowIso };
                a.parishes++; a.members += s.memberCount; a.clergy += s.clergyCount; a.births += s.birthCount; a.deaths += s.deathCount;
                if (b) { a.attendance += Math.max(0, s.attendanceTotal - b.attendanceTotal); a.birthsMonth += Math.max(0, s.birthCount - b.birthCount); a.deathsMonth += Math.max(0, s.deathCount - b.deathCount); }
                if (filed.has(p.id)) a.returnsFiled++;
            }
        }
        return agg;
    }

    // What the AI summary sees: counts only (by rule and by country), plus world totals. Never parish or person names.
    function summaryTotals(m, alerts, world) {
        const byRule = {}, byCountry = {};
        for (const a of alerts) { byRule[RULE_NAMES[a.rule] || a.rule] = (byRule[RULE_NAMES[a.rule] || a.rule] || 0) + 1; if (a.country) byCountry[a.country] = (byCountry[a.country] || 0) + 1; }
        const w = world || {};
        return { month: monthName(m), alerts: alerts.length, alertsByType: byRule, alertsByCountry: byCountry,
            world: { parishes: w.parishes || 0, members: w.members || 0, clergy: w.clergy || 0, attendanceThisMonth: w.attendance || 0,
                birthsThisMonth: w.birthsMonth || 0, deathsThisMonth: w.deathsMonth || 0, returnsFiled: w.returnsFiled || 0 } };
    }

    globalThis.AlertsCore = { RULE_NAMES, addMonths, addDays, monthName, slug, returnAlerts, statsAlerts, snapshot, rollups, summaryTotals, monthAtt };
})();
