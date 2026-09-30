import requests
import paramiko
import json

SERVER = "10.255.255.28"
USER = "enging"
PASS = "enging!pt"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(SERVER, port=22, username=USER, password=PASS)

# 1. Obter cookie de sessão efetuando login
session = requests.Session()
res_login = session.post(f"https://{SERVER}/login", data={"username": "admin", "password": "admin"}, verify=False)
print("Login HTTP status:", res_login.status_code)

# 2. Testar GET /api/connections com sessão
res_conn = session.get(f"https://{SERVER}/api/connections", verify=False)
print("GET /api/connections status:", res_conn.status_code)
conn_data = res_conn.json()
print("NUT server host:", conn_data.get("nut_server", {}).get("host"))
print("Proxmox servers:", len(conn_data.get("proxmox_servers", [])))
print("VMware servers:", len(conn_data.get("vmware_servers", [])))
print("API Tokens:", len(conn_data.get("api_tokens", [])))

# 3. Testar endpoint externo Bearer token
_, stdout, _ = ssh.exec_command("cat /opt/nut-dashboard/connections_data.json")
raw_json = stdout.read().decode('utf-8')
data_on_disk = json.loads(raw_json)
token = data_on_disk["api_tokens"][0]["token"]
print("Testing Bearer Token:", token[:15] + "...")

res_v1 = requests.get(f"https://{SERVER}/api/v1/status", headers={"Authorization": f"Bearer {token}"}, verify=False)
print("GET /api/v1/status status:", res_v1.status_code)
print("V1 Data Sample:", res_v1.json().get("device"), "| Voltage:", res_v1.json().get("data", {}).get("input", {}).get("voltage"))

# 4. Testar teste de socket NUT
res_nut_test = session.post(f"https://{SERVER}/api/connections/nut/test", json={"host": "127.0.0.1", "port": 3493, "ups_name": "ups"}, verify=False)
print("NUT test socket response:", res_nut_test.json().get("message"))

ssh.close()
