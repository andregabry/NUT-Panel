import paramiko
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SERVER = "10.255.255.28"
USER = "enging"
PASS = "password123"
REMOTE_DIR = "/opt/nut-dashboard/whatsapp_service"

def run_sudo(ssh, cmd):
    print(f"\n[EXEC] {cmd}")
    stdin, stdout, stderr = ssh.exec_command(f"sudo -S -p '' bash -c \"{cmd}\"")
    stdin.write(f"{PASS}\n")
    stdin.flush()
    
    # Stream output
    while True:
        line = stdout.readline()
        if not line:
            break
        print(line.rstrip())
    
    err = stderr.read().decode('utf-8', errors='replace')
    if err.strip():
        # filter out sudo prompts
        filtered_err = "\n".join([l for l in err.splitlines() if "password for" not in l.lower()])
        if filtered_err.strip():
            print(f"[STDERR] {filtered_err.strip()[:300]}")

def setup():
    print(f"[*] Conectando via SSH a {SERVER}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER, port=22, username=USER, password=PASS, timeout=15)

    # 1. Instalar Node.js e NPM
    print("\n--- 1. Verificando e Instalando Node.js / NPM ---")
    run_sudo(ssh, "export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && apt-get install -y nodejs npm")
    
    # 2. Criar diretórios
    print("\n--- 2. Criando diretórios do WhatsApp Service ---")
    run_sudo(ssh, f"mkdir -p {REMOTE_DIR} /opt/nut-dashboard/whatsapp_auth")
    run_sudo(ssh, f"chown -R {USER}:{USER} /opt/nut-dashboard/whatsapp_service /opt/nut-dashboard/whatsapp_auth")

    # 3. Transferir arquivos do WhatsApp Service via SFTP
    print("\n--- 3. Transferindo arquivos do WhatsApp Microservice ---")
    sftp = ssh.open_sftp()
    local_dir = r"c:\Users\andre.gabry\Projects\NUT\whatsapp_service"
    
    files = ["package.json", "server.js"]
    for f in files:
        l_path = os.path.join(local_dir, f)
        r_path = f"{REMOTE_DIR}/{f}"
        print(f"Enviando {f} -> {r_path}...")
        sftp.put(l_path, r_path)
    sftp.close()

    # 4. Instalar dependências npm
    print("\n--- 4. Instalando dependências npm (Baileys, Express, QRCode, Pino) ---")
    run_sudo(ssh, f"cd {REMOTE_DIR} && npm install --omit=dev --no-audit --no-fund")

    # 5. Configurar systemd service
    print("\n--- 5. Configurando serviço systemd (nut-whatsapp.service) ---")
    service_content = """[Unit]
Description=NUT Panel WhatsApp Web Microservice (Baileys)
After=network.target

[Service]
Type=simple
User=enging
WorkingDirectory=/opt/nut-dashboard/whatsapp_service
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3001
Environment=AUTH_DIR=/opt/nut-dashboard/whatsapp_auth

[Install]
WantedBy=multi-user.target
"""
    run_sudo(ssh, f"cat << 'EOF' > /etc/systemd/system/nut-whatsapp.service\n{service_content}\nEOF")
    run_sudo(ssh, "systemctl daemon-reload")
    run_sudo(ssh, "systemctl enable nut-whatsapp.service")
    run_sudo(ssh, "systemctl restart nut-whatsapp.service")

    # 6. Aguardar e verificar status do endpoint
    print("\n--- 6. Verificando status do microserviço na porta 3001 ---")
    time.sleep(3)
    run_sudo(ssh, "systemctl status nut-whatsapp.service --no-pager")
    run_sudo(ssh, "curl -s http://127.0.0.1:3001/status | head -c 200")

    ssh.close()
    print("\n[✔] Microserviço WhatsApp Web instalado e iniciado com sucesso!")

if __name__ == '__main__':
    setup()
