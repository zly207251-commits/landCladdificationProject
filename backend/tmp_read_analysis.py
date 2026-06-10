import pathlib, zipfile, re
from pathlib import Path
folder = Path('ملفات تحليل')
files = sorted(folder.iterdir(), key=lambda x: x.name)
print('FILES:', [x.name for x in files])
for p in files:
    print('\n' + '='*80)
    print('FILE:', p.name)
    if p.suffix.lower() == '.docx':
        try:
            with zipfile.ZipFile(p, 'r') as z:
                data = z.read('word/document.xml').decode('utf-8', errors='ignore')
                text = re.sub(r'<[^>]+>', ' ', data)
                text = re.sub(r'\s+', ' ', text).strip()
                print(text[:4000])
        except Exception as e:
            print('DOCX-ERROR:', e)
    elif p.suffix.lower() == '.pdf':
        try:
            import PyPDF2
            with open(p, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                txt = ''
                for page in reader.pages[:3]:
                    txt += page.extract_text() or ''
                print(txt[:4000])
        except Exception as e:
            try:
                with open(p, 'rb') as f:
                    b = f.read()
                text = re.sub(rb'[^\x20-\x7E\x0A\x0D]+', b' ', b)
                print(text[:4000].decode('utf-8', errors='ignore'))
            except Exception as e2:
                print('PDF-ERROR:', e, e2)
    else:
        print('SKIPPED')
