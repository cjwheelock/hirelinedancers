"""Install the event listener. Retire the previous poll only after verifying readiness."""
import os
import pathlib
import plistlib
import shutil
import subprocess

source = pathlib.Path(__file__).resolve().parent
home = pathlib.Path.home()
target = home / "Library/Application Support/HireLineDancers/spotlight-listener"
label = "com.hirelinedancers.spotlight-events"
plist = home / "Library/LaunchAgents" / f"{label}.plist"
node, gh, npm = (shutil.which(name) for name in ("node", "gh", "npm"))
if not all((node, gh, npm)):
    raise SystemExit("Node, npm and an authenticated gh installation are required.")
subprocess.run([gh, "auth", "status"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
target.mkdir(parents=True, exist_ok=True)
plist.parent.mkdir(parents=True, exist_ok=True)
for name in ("spotlight-publication.mjs", "spotlight-events.mjs", "spotlight-listener.mjs"):
    shutil.copyfile(source / name, target / name)
for name in ("package.json", "package-lock.json"):
    shutil.copyfile(source / "spotlight-listener" / name, target / name)
subprocess.run([npm, "ci", "--omit=dev", "--ignore-scripts", "--prefix", str(target)], check=True)
config = {
    "Label": label,
    "ProgramArguments": [node, str(target / "spotlight-listener.mjs")],
    "WorkingDirectory": str(target),
    "KeepAlive": True,
    "ThrottleInterval": 60,
    "RunAtLoad": True,
    "ProcessType": "Background",
    "EnvironmentVariables": {
        "GH_BIN": gh,
        "NEXT_PUBLIC_SUPABASE_URL": "https://wzmyroeowbsxxibkeejf.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_36gNqu74ysQhY2_VvJlS4A_XTYUFyxe",
        "SPOTLIGHT_LISTENER_STATE": str(target / "status.json"),
    },
    "StandardOutPath": str(target / "listener.log"),
    "StandardErrorPath": str(target / "listener-error.log"),
}
with plist.open("wb") as handle:
    plistlib.dump(config, handle)
domain = f"gui/{os.getuid()}"
subprocess.run(["launchctl", "bootout", f"{domain}/{label}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
print(f"Installed {label}. State: {target / 'status.json'}")
print("The previous polling agent is unchanged. Retire it only after the event listener is ready.")
