import paramiko
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SERVER_IP = "10.255.255.28"
USER = "enging"
PASS = "enging!pt"
REMOTE_DIR = "/opt/nut-dashboard"

def deploy():
    print(f"[*] Conectando via SSH a {SERVER_IP}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER_IP, port=22, username=USER, password=PASS, timeout=10)
    
    def sudo_cmd(cmd):
        print(f"\n[EXEC] {cmd}")
        stdin, stdout, stderr = ssh.exec_command(f"sudo -S -p '' bash -c \"{cmd}\"")
        stdin.write(f"{PASS}\n")
        stdin.flush()
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        if out.strip():
            print(out.strip())
        if err.strip():
            print(f"[STDERR] {err.strip()}")
        return out

    # 1. Criar diretórios e atribuir permissões ao utilizador enging
    sudo_cmd(f"mkdir -p {REMOTE_DIR}/static/img {REMOTE_DIR}/templates {REMOTE_DIR}/static/css {REMOTE_DIR}/static/js")
    sudo_cmd(f"chown -R {USER}:{USER} {REMOTE_DIR}")

    # 2. Transferir ficheiros via SFTP
    print("\n--- 1. Transferindo ficheiros atualizados ---")
    sftp = ssh.open_sftp()
    local_dir = r"c:\Users\andre.gabry\Projects\NUT"
    
    files_to_upload = [
        ("config.py", f"{REMOTE_DIR}/config.py"),
        ("app.py", f"{REMOTE_DIR}/app.py"),
        ("auth_manager.py", f"{REMOTE_DIR}/auth_manager.py"),
        ("alert_manager.py", f"{REMOTE_DIR}/alert_manager.py"),
        ("connections_manager.py", f"{REMOTE_DIR}/connections_manager.py"),
        ("nut_client.py", f"{REMOTE_DIR}/nut_client.py"),
        ("shutdown_manager.py", f"{REMOTE_DIR}/shutdown_manager.py"),
        ("templates/login.html", f"{REMOTE_DIR}/templates/login.html"),
        ("templates/index.html", f"{REMOTE_DIR}/templates/index.html"),
        ("static/css/style.css", f"{REMOTE_DIR}/static/css/style.css"),
        ("static/js/app.js", f"{REMOTE_DIR}/static/js/app.js"),
        ("whatsapp_service/server.js", f"{REMOTE_DIR}/whatsapp_service/server.js"),
    ]

    for local_rel, remote_path in files_to_upload:
        local_path = os.path.join(local_dir, local_rel.replace('/', os.sep))
        print(f"Enviando {local_rel} -> {remote_path}...")
        sftp.put(local_path, remote_path)

    sftp.close()

    # 3. Reiniciar serviços
    print("\n--- 2. Reiniciando nut-dashboard.service e nut-whatsapp.service ---")
    sudo_cmd("systemctl restart nut-dashboard.service nut-whatsapp.service")
    sudo_cmd("systemctl status nut-dashboard.service nut-whatsapp.service --no-pager")

    # 4. Testar resposta
    print("\n--- 3. Verificando rota /login e status do serviço ---")
    sudo_cmd("sleep 3 && curl -k -s -o /dev/null -w 'HTTP Status Dashboard: %{http_code}\n' https://127.0.0.1/login")
    sudo_cmd("curl -s http://127.0.0.1:3001/status | head -c 100")

    ssh.close()
    print("\n[✔] Implantação do Enging UPS System concluída com sucesso!")

if __name__ == '__main__':
    deploy()
