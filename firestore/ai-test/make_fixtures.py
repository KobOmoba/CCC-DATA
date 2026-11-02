# Builds the 3 accuracy-test files (DOCX list, PDF table, phone-photo image) and truth.json.
import json, random, os
from docx import Document
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = os.path.dirname(os.path.abspath(__file__))
M = ["January","February","March","April","May","June","July","August","September","October","November","December"]
def P(fullName, gender, marital, address, phone, rank, occupation, dob, anoint=None, nok=("", "", ""), email=""):
    return dict(fullName=fullName, gender=gender, maritalStatus=marital, address=address, phone=phone, email=email, rank=rank,
                occupation=occupation, dobDay=dob[0], dobMonth=dob[1], dobYear=dob[2] if len(dob) > 2 else None,
                anointDay=anoint[0] if anoint else None, anointMonth=anoint[1] if anoint else None, anointYear=anoint[2] if anoint else None,
                nokName=nok[0], nokAddress=nok[1], nokPhone=nok[2])
docx_people = [
    P("Adebayo Olumide Ogunleye", "Male", "Married", "14 Adeola Odeku Street, Victoria Island, Lagos", "08031234567", "Senior Leader", "Engineer",
      (12, 3, 1975), (25, 12, 2024), ("Folasade Ogunleye", "14 Adeola Odeku Street, Lagos", "08039876543"), "adebayo.ogunleye@example.com"),
    P("Oluwaseun Abimbola Adeyemi", "Female", "Single", "7 Ring Road, Ibadan", "07065554321", "Elder Sister", "Nurse",
      (5, 9), (1, 1, 2025), ("Kehinde Adeyemi", "Bodija, Ibadan", "08025550000")),
    P("Babatunde Akinwale Fashola", "Male", "Widowed", "22 Oke-Ado Road, Ibadan", "08123450987", "Evangelist", "Trader",
      (30, 11, 1960), None, ("Yetunde Fashola", "Mokola, Ibadan", "08167770123")),
    P("Moradeke Iyabo Olatunji", "Female", "Married", "3 Church Close, Abeokuta", "09012223344", "Mother Celestial", "Caterer",
      (17, 6, 1968), (24, 12, 2023), ("Olusegun Olatunji", "3 Church Close, Abeokuta", "09012223345")),
]
pdf_people = [
    P("Oluwafemi Adekunle Bankole", "Male", "Married", "5 Allen Avenue, Ikeja", "08051112233", "Cape Elder Brother", "Accountant", (2, 2, 1982), (25, 12, 2025), ("Titilayo Bankole", "5 Allen Avenue, Ikeja", "08051112234")),
    P("Omowunmi Folake Adesanya", "Female", "Married", "18 Ijebu Road, Sagamu", "07033334455", "Senior Elder Sister", "Teacher", (21, 4, 1979), (1, 1, 2026), ("Ayodele Adesanya", "18 Ijebu Road, Sagamu", "07033334456")),
    P("Kolawole Ayodeji Ojo", "Male", "Single", "9 Oba Adesida Road, Akure", "08164445566", "Brother", "Student", (8, 10, 2001), None, ("Comfort Ojo", "Akure", "08164445500")),
    P("Ibukunoluwa Temitope Alade", "Female", "Divorced", "41 Lagos Road, Ikorodu", "09056667788", "Sister", "Hairdresser", (14, 7), None, ("Funmilayo Alade", "Ikorodu", "09056667700")),
    P("Olanrewaju Gbenga Oyelaran", "Male", "Married", "2 Isale Eko Street, Lagos Island", "08077778899", "Superior Evangelist", "Civil servant", (29, 1, 1958), (24, 12, 2025), ("Bolanle Oyelaran", "Lagos Island", "08077778800")),
]
photo_people = [
    P("Oluwatoyin Abosede Ajayi", "Female", "Married", "12 Ogunlana Drive, Surulere", "08034561234", "Cape Elder Sister", "Tailor", (3, 5, 1974), (25, 12, 2024), ("Tunde Ajayi", "", "08034560000")),
    P("Olusola Babajide Ogundipe", "Male", "Married", "6 Ilupeju Road, Lagos", "08145672345", "Full Elder Brother", "Driver", (19, 8, 1970), None, ("Bisi Ogundipe", "", "08145670000")),
    P("Adeola Mojisola Akinola", "Female", "Single", "31 Agege Motor Road, Mushin", "07056783456", "Sister", "Student", (11, 12, 2003), None, ("Sunday Akinola", "", "07056780000")),
    P("Ayomide Oluwadamilare Ilesanmi", "Male", "Single", "8 Ikorodu Road, Ketu", "09067894567", "Leader", "Mechanic", (27, 2, 1990), (1, 1, 2026), ("Grace Ilesanmi", "", "09067890000")),
    P("Funmilola Adunni Oladipo", "Female", "Widowed", "15 Ojuelegba Street, Yaba", "08078905678", "Mother Celestial", "Petty trader", (6, 6, 1955), (24, 12, 2025), ("Femi Oladipo", "", "08078900000")),
]
def dob(p): return f"{p['dobDay']} {M[p['dobMonth']-1]}" + (f" {p['dobYear']}" if p['dobYear'] else "")
def an(p): return f"{p['anointDay']}/{p['anointMonth']}/{p['anointYear']}" if p['anointDay'] else ""

# 1. DOCX: one block of lines per person (how a secretary would type it).
d = Document(); d.add_heading("CCC Cathedral Parish - Members List (2026)", 1)
for i, p in enumerate(docx_people, 1):
    d.add_paragraph(f"{i}. {'Bro.' if p['gender']=='Male' else 'Sis.'} {p['fullName']} ({p['rank']})")
    for line in [f"Marital status: {p['maritalStatus']}", f"Address: {p['address']}", f"Phone: {p['phone']}"] + \
            ([f"Email: {p['email']}"] if p['email'] else []) + [f"Occupation: {p['occupation']}", f"Date of birth: {dob(p)}"] + \
            ([f"Last anointment: {an(p)}"] if p['anointDay'] else []) + [f"Next of kin: {p['nokName']}, {p['nokAddress']}, {p['nokPhone']}"]:
        d.add_paragraph(line)
d.save(os.path.join(OUT, "members-list.docx"))

# 2. PDF table.
st = getSampleStyleSheet()["BodyText"]; st.fontSize = 7; st.leading = 8
hdr = ["Name", "Sex", "Marital", "Address", "Phone", "Rank", "Occupation", "Birthday", "Last anointed", "Next of kin", "NOK phone"]
rows = [hdr] + [[Paragraph(str(c), st) for c in [p['fullName'], "M" if p['gender']=="Male" else "F", p['maritalStatus'], p['address'], p['phone'], p['rank'],
        p['occupation'], dob(p), an(p), f"{p['nokName']} ({p['nokAddress']})", p['nokPhone']]] for p in pdf_people]
t = Table(rows, repeatRows=1); t.setStyle(TableStyle([("GRID", (0,0), (-1,-1), 0.5, colors.grey), ("BACKGROUND", (0,0), (-1,0), colors.lightgrey), ("FONTSIZE", (0,0), (-1,0), 7)]))
SimpleDocTemplate(os.path.join(OUT, "members-table.pdf"), pagesize=landscape(A4)).build([Paragraph("CCC Parish Register - New Members", getSampleStyleSheet()["Title"]), t])

# 3. Phone-photo style image: a printed+pen-style list on a slightly skewed, shaded, noisy page.
random.seed(7)
W, H = 1600, 1900
page = Image.new("RGB", (W, H), (244, 240, 228)); dr = ImageDraw.Draw(page)
for y in range(150, H, 62): dr.line([(60, y), (W - 60, y)], fill=(170, 190, 220), width=2)
fh = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf", 40)
fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
dr.text((80, 50), "C.C.C. Parish - New members (pen list)", fill=(20, 20, 90), font=fb)
y = 160
for i, p in enumerate(photo_people, 1):
    lines = [f"{i}. {p['fullName']}  - {p['rank']}, {p['maritalStatus']}",
             f"   {p['address']}.  Tel {p['phone']}",
             f"   {p['occupation']}.  Born {dob(p)}" + (f".  Anointed {an(p)}" if p['anointDay'] else ""),
             f"   Next of kin: {p['nokName']} {p['nokPhone']}"]
    for ln in lines:
        dr.text((80 + random.randint(-4, 4), y - 44), ln, fill=(25, 30, 110), font=fh); y += 62
    y += 20
page = page.rotate(-2.5, expand=True, fillcolor=(60, 55, 50), resample=Image.BICUBIC)
shade = Image.linear_gradient("L").resize(page.size).rotate(90)
page = Image.composite(page, Image.new("RGB", page.size, (150, 140, 120)), shade.point(lambda v: 160 + v // 3))
noise = Image.effect_noise(page.size, 18).convert("RGB")
page = Image.blend(page, noise, 0.06).filter(ImageFilter.GaussianBlur(0.9))
page.resize((page.width * 3 // 4, page.height * 3 // 4)).save(os.path.join(OUT, "members-photo.jpg"), quality=78)

json.dump({"members-list.docx": docx_people, "members-table.pdf": pdf_people, "members-photo.jpg": photo_people},
          open(os.path.join(OUT, "truth.json"), "w"), indent=1)
print("ok")
