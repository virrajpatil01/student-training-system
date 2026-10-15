import re
import os
import glob
from pathlib import Path
from dotenv import load_dotenv

backend_env = Path(__file__).parent / ".env"
load_dotenv(backend_env)

from shuffle_service import get_supabase_client

def save_tokens():
    files = glob.glob(r'C:\Users\visha\AppData\Local\Microsoft\Edge\User Data\Default\Local Storage\leveldb\*.*')
    c = get_supabase_client()
    
    for f in sorted(files, key=os.path.getmtime, reverse=True):
        try:
            content = open(f, 'rb').read().decode('latin1', errors='ignore')
            rts = re.findall(r'"refresh_token":"([^"]+)"', content)
            for rt in reversed(rts):
                try:
                    res = c.auth.refresh_session(rt)
                    if res and res.session and res.session.access_token:
                        token = res.session.access_token
                        new_rt = res.session.refresh_token
                        print(f"Acquired token from {f}!")
                        open('active_token.txt', 'w').write(token)
                        open('system_refresh_token.txt', 'w').write(new_rt or rt)
                        print("Saved active_token.txt and system_refresh_token.txt")
                        return
                except Exception:
                    pass
        except Exception:
            continue
    print("Could not find a valid refresh token.")

if __name__ == "__main__":
    save_tokens()
