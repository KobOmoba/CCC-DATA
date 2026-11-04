// Static, offline location data for parish Country -> State -> City dropdowns. No external API.
// Countries: "Name|Continent". Priority countries first, the rest A-Z.
const LOC_PRIORITY = ["Nigeria", "Benin", "Ghana", "Togo", "Cote d'Ivoire", "United Kingdom", "United States", "Canada", "Ireland", "South Africa"];
const LOC_COUNTRIES = (() => {
    const AF = "Africa", EU = "Europe", AS = "Asia", NA = "North America", SA = "South America", OC = "Oceania";
    const raw = {
        [AF]: "Algeria,Angola,Benin,Botswana,Burkina Faso,Burundi,Cabo Verde,Cameroon,Central African Republic,Chad,Comoros,Congo,Cote d'Ivoire,Democratic Republic of the Congo,Djibouti,Egypt,Equatorial Guinea,Eritrea,Eswatini,Ethiopia,Gabon,Gambia,Ghana,Guinea,Guinea-Bissau,Kenya,Lesotho,Liberia,Libya,Madagascar,Malawi,Mali,Mauritania,Mauritius,Morocco,Mozambique,Namibia,Niger,Nigeria,Rwanda,Sao Tome and Principe,Senegal,Seychelles,Sierra Leone,Somalia,South Africa,South Sudan,Sudan,Tanzania,Togo,Tunisia,Uganda,Zambia,Zimbabwe",
        [EU]: "Albania,Andorra,Austria,Belarus,Belgium,Bosnia and Herzegovina,Bulgaria,Croatia,Cyprus,Czech Republic,Denmark,Estonia,Finland,France,Germany,Greece,Hungary,Iceland,Ireland,Italy,Kosovo,Latvia,Liechtenstein,Lithuania,Luxembourg,Malta,Moldova,Monaco,Montenegro,Netherlands,North Macedonia,Norway,Poland,Portugal,Romania,Russia,San Marino,Serbia,Slovakia,Slovenia,Spain,Sweden,Switzerland,Ukraine,United Kingdom,Vatican City",
        [AS]: "Afghanistan,Armenia,Azerbaijan,Bahrain,Bangladesh,Bhutan,Brunei,Cambodia,China,Georgia,India,Indonesia,Iran,Iraq,Israel,Japan,Jordan,Kazakhstan,Kuwait,Kyrgyzstan,Laos,Lebanon,Malaysia,Maldives,Mongolia,Myanmar,Nepal,North Korea,Oman,Pakistan,Palestine,Philippines,Qatar,Saudi Arabia,Singapore,South Korea,Sri Lanka,Syria,Taiwan,Tajikistan,Thailand,Timor-Leste,Turkey,Turkmenistan,United Arab Emirates,Uzbekistan,Vietnam,Yemen",
        [NA]: "Antigua and Barbuda,Bahamas,Barbados,Belize,Canada,Costa Rica,Cuba,Dominica,Dominican Republic,El Salvador,Grenada,Guatemala,Haiti,Honduras,Jamaica,Mexico,Nicaragua,Panama,Saint Kitts and Nevis,Saint Lucia,Saint Vincent and the Grenadines,Trinidad and Tobago,United States",
        [SA]: "Argentina,Bolivia,Brazil,Chile,Colombia,Ecuador,Guyana,Paraguay,Peru,Suriname,Uruguay,Venezuela",
        [OC]: "Australia,Fiji,Kiribati,Marshall Islands,Micronesia,Nauru,New Zealand,Palau,Papua New Guinea,Samoa,Solomon Islands,Tonga,Tuvalu,Vanuatu"
    };
    const cont = {};
    for (const [c, list] of Object.entries(raw)) list.split(",").forEach(n => cont[n] = c);
    const rest = Object.keys(cont).filter(n => !LOC_PRIORITY.includes(n)).sort((a, b) => a.localeCompare(b));
    return { names: [...LOC_PRIORITY, ...rest], continent: cont };
})();
const LOC_CURRENCY = { Nigeria: "NGN", Ghana: "GHS", Benin: "XOF", Togo: "XOF", "Cote d'Ivoire": "XOF", Senegal: "XOF", Mali: "XOF", "Burkina Faso": "XOF", Niger: "XOF",
    Cameroon: "XAF", Gabon: "XAF", Chad: "XAF", Congo: "XAF", "South Africa": "ZAR", Kenya: "KES", "United Kingdom": "GBP", Ireland: "EUR", Germany: "EUR", France: "EUR",
    Italy: "EUR", Spain: "EUR", Netherlands: "EUR", Belgium: "EUR", Portugal: "EUR", Austria: "EUR", Finland: "EUR", Greece: "EUR", "United States": "USD", Canada: "CAD",
    Australia: "AUD", Switzerland: "CHF", Sweden: "SEK", Norway: "NOK", Denmark: "DKK", "United Arab Emirates": "AED", India: "INR", China: "CNY", Japan: "JPY", Brazil: "BRL" };
const LOC_STATES = {
    Benin: "Alibori,Atacora,Atlantique,Borgou,Collines,Couffo,Donga,Littoral,Mono,Oueme,Plateau,Zou",
    Ghana: "Ahafo,Ashanti,Bono,Bono East,Central,Eastern,Greater Accra,North East,Northern,Oti,Savannah,Upper East,Upper West,Volta,Western,Western North",
    Togo: "Centrale,Kara,Maritime,Plateaux,Savanes",
    "United Kingdom": "England,Scotland,Wales,Northern Ireland",
    "United States": "Alabama,Alaska,Arizona,Arkansas,California,Colorado,Connecticut,Delaware,District of Columbia,Florida,Georgia,Hawaii,Idaho,Illinois,Indiana,Iowa,Kansas,Kentucky,Louisiana,Maine,Maryland,Massachusetts,Michigan,Minnesota,Mississippi,Missouri,Montana,Nebraska,Nevada,New Hampshire,New Jersey,New Mexico,New York,North Carolina,North Dakota,Ohio,Oklahoma,Oregon,Pennsylvania,Rhode Island,South Carolina,South Dakota,Tennessee,Texas,Utah,Vermont,Virginia,Washington,West Virginia,Wisconsin,Wyoming",
    Canada: "Alberta,British Columbia,Manitoba,New Brunswick,Newfoundland and Labrador,Northwest Territories,Nova Scotia,Nunavut,Ontario,Prince Edward Island,Quebec,Saskatchewan,Yukon",
    "South Africa": "Eastern Cape,Free State,Gauteng,KwaZulu-Natal,Limpopo,Mpumalanga,North West,Northern Cape,Western Cape",
    Ireland: "Carlow,Cavan,Clare,Cork,Donegal,Dublin,Galway,Kerry,Kildare,Kilkenny,Laois,Leitrim,Limerick,Longford,Louth,Mayo,Meath,Monaghan,Offaly,Roscommon,Sligo,Tipperary,Waterford,Westmeath,Wexford,Wicklow",
    "Cote d'Ivoire": "Abidjan,Bas-Sassandra,Comoe,Denguele,Goh-Djiboua,Lacs,Lagunes,Montagnes,Sassandra-Marahoue,Savanes,Vallee du Bandama,Woroba,Yamoussoukro,Zanzan"
};
// Nigeria: 36 states + FCT, each with main cities/towns.
const LOC_NG = {
    Abia: "Umuahia,Aba,Ohafia,Arochukwu,Bende,Isuikwuato,Item",
    Adamawa: "Yola,Jimeta,Mubi,Numan,Ganye,Gombi,Michika",
    "Akwa Ibom": "Uyo,Eket,Ikot Ekpene,Oron,Abak,Ikot Abasi,Itu",
    Anambra: "Awka,Onitsha,Nnewi,Ekwulobia,Ihiala,Agulu,Otuocha",
    Bauchi: "Bauchi,Azare,Misau,Jama'are,Katagum,Tafawa Balewa,Darazo",
    Bayelsa: "Yenagoa,Brass,Ogbia,Sagbama,Nembe,Kaiama,Amassoma",
    Benue: "Makurdi,Gboko,Otukpo,Katsina-Ala,Vandeikya,Adikpo,Aliade",
    Borno: "Maiduguri,Biu,Bama,Dikwa,Gwoza,Monguno,Konduga",
    "Cross River": "Calabar,Ikom,Ogoja,Obudu,Ugep,Akamkpa,Obubra",
    Delta: "Asaba,Warri,Sapele,Ughelli,Agbor,Effurun,Abraka,Oleh,Kwale,Burutu",
    Ebonyi: "Abakaliki,Afikpo,Onueke,Ezza,Ishiagu,Edda",
    Edo: "Benin City,Auchi,Ekpoma,Uromi,Igueben,Irrua,Okada,Igarra",
    Ekiti: "Ado-Ekiti,Ikere-Ekiti,Ijero-Ekiti,Efon-Alaaye,Ikole-Ekiti,Ise-Ekiti,Omuo-Ekiti,Ido-Ekiti",
    Enugu: "Enugu,Nsukka,Oji River,Agbani,Awgu,Udi,Enugu-Ezike",
    FCT: "Abuja,Gwagwalada,Kubwa,Kuje,Bwari,Karu,Nyanya,Lugbe",
    Gombe: "Gombe,Kaltungo,Billiri,Dukku,Bajoga,Kumo",
    Imo: "Owerri,Orlu,Okigwe,Oguta,Mbaise,Mbano,Mgbidi",
    Jigawa: "Dutse,Hadejia,Kazaure,Gumel,Birnin Kudu,Ringim",
    Kaduna: "Kaduna,Zaria,Kafanchan,Kagoro,Zonkwa,Saminaka,Kachia",
    Kano: "Kano,Wudil,Gaya,Rano,Bichi,Dawakin Tofa,Karaye",
    Katsina: "Katsina,Funtua,Daura,Malumfashi,Dutsin-Ma,Kankia",
    Kebbi: "Birnin Kebbi,Argungu,Yauri,Zuru,Jega,Koko",
    Kogi: "Lokoja,Okene,Idah,Kabba,Anyigba,Ankpa,Ajaokuta,Isanlu",
    Kwara: "Ilorin,Offa,Omu-Aran,Jebba,Lafiagi,Patigi,Kaiama,Share",
    Lagos: "Ikeja,Lagos Island,Victoria Island,Lekki,Ajah,Surulere,Yaba,Mushin,Oshodi,Ikorodu,Epe,Badagry,Ikotun,Alimosho,Agege,Ojo,Festac,Apapa,Ketu,Ogba",
    Nasarawa: "Lafia,Keffi,Akwanga,Nasarawa,Karu,Doma,Mararaba",
    Niger: "Minna,Bida,Suleja,Kontagora,New Bussa,Lapai,Mokwa",
    Ogun: "Abeokuta,Ijebu-Ode,Sagamu,Ota,Ilaro,Ifo,Ikenne,Ilishan-Remo,Ijebu-Igbo,Ago-Iwoye,Mowe,Ibafo,Owode,Idiroko,Itori",
    Ondo: "Akure,Ondo,Owo,Ikare-Akoko,Okitipupa,Ore,Igbokoda,Idanre",
    Osun: "Osogbo,Ile-Ife,Ilesa,Ede,Iwo,Ikirun,Ila-Orangun,Ikire,Ejigbo",
    Oyo: "Ibadan,Ogbomoso,Oyo,Iseyin,Saki,Igboho,Eruwa,Igbo-Ora,Kishi",
    Plateau: "Jos,Bukuru,Pankshin,Shendam,Langtang,Barkin Ladi,Wase",
    Rivers: "Port Harcourt,Obio-Akpor,Bonny,Okrika,Omoku,Ahoada,Bori,Eleme,Oyigbo",
    Sokoto: "Sokoto,Wamakko,Tambuwal,Gwadabawa,Illela,Bodinga",
    Taraba: "Jalingo,Wukari,Bali,Takum,Serti,Gembu,Zing",
    Yobe: "Damaturu,Potiskum,Gashua,Nguru,Geidam,Buni Yadi",
    Zamfara: "Gusau,Kaura Namoda,Talata Mafara,Anka,Tsafe,Bungudu"
};
LOC_STATES.Nigeria = Object.keys(LOC_NG).join(",");
const LOC_OTHER = "__other__";
const locStates = c => LOC_STATES[c] ? LOC_STATES[c].split(",") : [];
const locCities = (c, s) => c === "Nigeria" && LOC_NG[s] ? LOC_NG[s].split(",") : [];
const locFind = (list, v) => list.find(x => x.toLowerCase() === String(v || "").trim().toLowerCase());

const LOC_REGIONS = ["Africa", "Europe", "North America", "South America", "Asia", "Oceania"];
const LOC_LISTS = {};
// Each location field has: hidden input #{p}{f} (the stored value, read by readLocation),
// a search box #{p}{f}_q, a select #{p}{f}_sel and an "Other" text box #{p}{f}_other.
function locOptions(p, f) {
    const e = x => String(x).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const sel = document.getElementById(p + f + "_sel"), q = document.getElementById(p + f + "_q");
    const { list, first } = LOC_LISTS[p + f], cur = sel.value;
    const term = (q ? q.value : "").trim().toLowerCase();
    const shown = list.filter(x => !term || x.toLowerCase().includes(term) || x === cur);
    sel.innerHTML = `<option value="">${term ? shown.length + " found" : first}</option>` + shown.map(x => `<option value="${e(x)}">${e(x)}</option>`).join("") + `<option value="${LOC_OTHER}">Other (type it)</option>`;
    sel.value = cur && (shown.includes(cur) || cur === LOC_OTHER) ? cur : "";
}
function locSync(p, f) {
    const sel = document.getElementById(p + f + "_sel"), other = document.getElementById(p + f + "_other");
    const isOther = sel.value === LOC_OTHER;
    other.classList.toggle("hidden", !isOther);
    document.getElementById(p + f).value = isOther ? other.value.trim() : sel.value;
}
function locSet(p, f, list, first, v, auto) {
    const sel = document.getElementById(p + f + "_sel"), other = document.getElementById(p + f + "_other"), q = document.getElementById(p + f + "_q");
    LOC_LISTS[p + f] = { list, first };
    if (q) q.value = "";
    sel.value = ""; locOptions(p, f);
    const hit = locFind(list, v);
    sel.value = hit || (v ? LOC_OTHER : "");
    other.value = hit ? "" : (v || "");
    if (auto && !list.length && !v) sel.value = LOC_OTHER;
    locSync(p, f);
}
const locRegion = p => (document.getElementById(p + "region_sel") || {}).value || "";
// Preselect stored values (falls back to "Other" text when not in the list).
function setLocationFields(p, country, state, city) {
    const known = locFind(LOC_COUNTRIES.names, country);
    const rs = document.getElementById(p + "region_sel");
    if (rs && known) rs.value = LOC_COUNTRIES.continent[known];
    const r = locRegion(p);
    locSet(p, "country", LOC_COUNTRIES.names.filter(n => !r || LOC_COUNTRIES.continent[n] === r), "Country", country);
    const c = document.getElementById(p + "country").value;
    locSet(p, "state", locStates(locFind(LOC_COUNTRIES.names, c) || ""), "State / region", state, !!c);
    const s = document.getElementById(p + "state").value;
    locSet(p, "city", locCities(locFind(LOC_COUNTRIES.names, c) || "", s), "City / town", city, !!s);
}
function locAutofill(p, country) {
    const cont = document.getElementById(p + "continent"), cur = document.getElementById(p + "currency");
    if (cont && LOC_COUNTRIES.continent[country]) cont.value = LOC_COUNTRIES.continent[country];
    if (cur && LOC_CURRENCY[country]) cur.value = LOC_CURRENCY[country];
}
function initLocationFields(p) {
    const $l = id => document.getElementById(p + id);
    const on = (f, fn) => {
        $l(f + "_sel").addEventListener("change", () => { locSync(p, f); fn && fn(); });
        $l(f + "_other").addEventListener("input", () => locSync(p, f));
        $l(f + "_q").addEventListener("input", () => { locOptions(p, f); locSync(p, f); });
    };
    const rs = $l("region_sel");
    rs.innerHTML = `<option value="">All continents</option>` + LOC_REGIONS.map(r => `<option value="${r}">${r}</option>`).join("");
    rs.addEventListener("change", () => {
        const c = $l("country").value, keep = c && (!rs.value || LOC_COUNTRIES.continent[c] === rs.value);
        setLocationFields(p, keep ? c : "", keep ? $l("state").value : "", keep ? $l("city").value : "");
        if (rs.value && $l("continent")) $l("continent").value = rs.value;
    });
    on("country", () => { const c = $l("country").value; setLocationFields(p, c, "", ""); locAutofill(p, c); });
    on("state", () => setLocationFields(p, $l("country").value, $l("state").value, ""));
    on("city");
    setLocationFields(p, "", "", "");
}
document.addEventListener("DOMContentLoaded", () => ["np_", "s_"].forEach(p => document.getElementById(p + "country_sel") && initLocationFields(p)));
