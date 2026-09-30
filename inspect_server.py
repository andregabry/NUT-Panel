import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def check_docker():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('10.255.255.28', port=22, username='enging', password='password123', timeout=5)
    
    def run(cmd, sudo=False):
        print(f"\n$ {cmd}")
        if sudo:
            stdin, stdout, stderr = ssh.exec_command(f"sudo -S -p '' bash -c \"{cmd}\"")
            stdin.write("password123\n")
            stdin.flush()
        else:
            stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        if out:
            print(out)
        if err:
            print("STDERR:", err)
        return out

    run("docker ps -a", sudo=True)

    ssh.close()

if __name__ == '__main__':
    check_docker()
