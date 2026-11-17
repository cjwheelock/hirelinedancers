"""Install the independent publication check using the existing local gh login."""
import os
import pathlib
import plistlib
import shutil
import subprocess

source = pathlib.Path(__file__).resolve().parent
home = pathlib.Path.home()
target = home / "Library/Application Support/HireLineDancers/spotlight-watchdog"
label = "com.hirelinedancers.spotlight-publication"
plist = home / "Library/LaunchAgents" / f"{label}.plist"
node = shutil.which("node")
gh = shutil.which("gh")
if not node or not gh:
    raise SystemExit("Install Node and authenticate gh before installing the watchdog.")
subprocess.run([gh, "auth", "status"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
target.mkdir(parents=True, exist_ok=True)
plist.parent.mkdir(parents=True, exist_ok=True)
for name in ("spotlight-publication.mjs", "spotlight-watchdog.mjs"):
    temporary = target / f"{name}.tmp"
    shutil.copyfile(source / name, temporary)
    temporary.replace(target / name)
config = {
    "Label": label,
    "ProgramArguments": [node, str(target / "spotlight-watchdog.mjs")],
    "WorkingDirectory": str(target),
    "StartInterval": 300,
    "RunAtLoad": True,
    "ProcessType": "Background",
    "EnvironmentVariables": {
        "GH_BIN": gh,
        "NEXT_PUBLIC_SUPABASE_URL": "https://wzmyroeowbsxxibkeejf.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_36gNqu74ysQhY2_VvJlS4A_XTYUFyxe",
        "SPOTLIGHT_WATCHDOG_STATE": str(target / "status.json"),
        "SPOTLIGHT_WATCHDOG_NOTIFY": "1",
    },
    "StandardOutPath": str(target / "watchdog.log"),
    "StandardErrorPath": str(target / "watchdog-error.log"),
}
with plist.open("wb") as handle:
    plistlib.dump(config, handle)
domain = f"gui/{os.getuid()}"
subprocess.run(["launchctl", "bootout", f"{domain}/{label}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
print(f"Installed {label}; checks every five minutes. State: {target / 'status.json'}")
