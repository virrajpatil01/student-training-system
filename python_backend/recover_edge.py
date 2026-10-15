import glob, os, re, json
from supabase import create_client

files = glob.glob(r'C:\Users\visha\AppData\Local\Microsoft\Edge\User Data\Default\Local Storage\leveldb\*.*')
files = sorted(files, key=os.path.getmtime, reverse=True)

found_json = False
for f in files:
    try:
        data = open(f, 'rb').read()
        idx = data.find(b'sb-zuxhwatwbwhruupujqeb-auth-token')
        if idx != -1:
            print('Found token key in:', f)
            brace_idx = data.find(b'{"access_token"', idx)
            if brace_idx != -1:
                end_idx = data.find(b'"expires_at"', brace_idx)
                if end_idx != -1:
                    chunk = data[brace_idx:end_idx+60]
                    chunk_str = chunk.decode('latin1', errors='ignore')
                    at_m = re.search(r'"access_token":"([^"]+)"', chunk_str)
                    rt_m = re.search(r'"refresh_token":"([^"]+)"', chunk_str)
                    if at_m:
                        print('Found access_token in', f)
                    if rt_m:
                        print('Found refresh_token in', f)
                        c = create_client('https://zuxhwatwbwhruupujqeb.supabase.co', 'sb_publishable_SXBEPIeE2zKMnA0AW5EgvA_cEXWok1a')
                        try:
                            res = c.auth.refresh_session(rt_m.group(1))
                            print('REFRESH SUCCESS! Fresh access token:', res.session.access_token[:20])
                            open('python_backend/active_token.txt', 'w').write(res.session.access_token)
                            open('python_backend/system_refresh_token.txt', 'w').write(res.session.refresh_token)
                            found_json = True
                            break
                        except Exception as e:
                            print('Refresh with this rt failed:', e)
    except Exception as e:
        pass

if not found_json:
    print('Searching all files for {"access_token"')
    for f in files:
        try:
            data = open(f, 'rb').read()
            idx = 0
            while True:
                idx = data.find(b'{"access_token"', idx)
                if idx == -1:
                    break
                end_idx = data.find(b'"expires_at"', idx)
                if end_idx != -1:
                    chunk = data[idx:end_idx+60].decode('latin1', errors='ignore')
                    rt_m = re.search(r'"refresh_token":"([^"]+)"', chunk)
                    if rt_m:
                        c = create_client('https://zuxhwatwbwhruupujqeb.supabase.co', 'sb_publishable_SXBEPIeE2zKMnA0AW5EgvA_cEXWok1a')
                        try:
                            res = c.auth.refresh_session(rt_m.group(1))
                            print('REFRESH SUCCESS from secondary search! Token:', res.session.access_token[:20])
                            open('python_backend/active_token.txt', 'w').write(res.session.access_token)
                            open('python_backend/system_refresh_token.txt', 'w').write(res.session.refresh_token)
                            found_json = True
                            break
                        except Exception as e:
                            pass
                idx += 15
            if found_json:
                break
        except Exception:
            pass

print('Complete. Token status:', found_json)
