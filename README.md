# ⚡ Enging UPS Management & Automation System (v2.0.0)

<div align="center">
  <img src="static/img/logo-horizontal.png" alt="Enging Logo" width="340" />
  <h3>Plataforma Centralizada de Monitorização em Tempo Real, Automação de Infraestrutura e Gestão de Incidentes para UPS Industriais</h3>
  <p><em>Desenvolvido para UPS <strong>INVT HT1106XS (6kVA / 6kW Online Double Conversion)</strong> com Integração Multi-Hipervisor (Proxmox VE & VMware ESXi), Auto-Religamento (WoL / IPMI) e Persistência ACID em SQLite.</em></p>

  <p>
    <img src="https://img.shields.io/badge/version-2.0.0-blue.svg?style=flat-square" alt="Version 2.0.0" />
    <img src="https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue?style=flat-square&logo=python" alt="Python" />
    <img src="https://img.shields.io/badge/database-SQLite%203%20(WAL%20Mode)-003B57?style=flat-square&logo=sqlite" alt="SQLite WAL" />
    <img src="https://img.shields.io/badge/node.js-18%2B%20(Baileys%20MD)-339933?style=flat-square&logo=node.js" alt="Node" />
    <img src="https://img.shields.io/badge/protocol-NUT%202.8%2B%20Modbus-critical?style=flat-square" alt="NUT" />
    <img src="https://img.shields.io/badge/hypervisors-Proxmox%20VE%20%7C%20VMware%20ESXi-orange?style=flat-square" alt="Hypervisors" />
    <img src="https://img.shields.io/badge/automation-Wake--on--LAN%20%7C%20IPMI%20BMC-success?style=flat-square" alt="Automation" />
  </p>
</div>

---

## 📋 Índice Geral

1. [Visão Geral da Solução](#-visão-geral-da-solução)
2. [O Que o Sistema Faz](#-o-que-o-sistema-faz)
3. [Como o Sistema Funciona (Engenharia & Mecanismos)](#-como-o-sistema-funciona-engenharia--mecanismos)
   - [3.1 Ciclo de Polling & Ingestão NUT](#31-ciclo-de-polling--ingestão-nut)
   - [3.2 Motor de Base de Dados SQLite com WAL (`db.py`)](#32-motor-de-base-de-dados-sqlite-com-wal-dbpy)
   - [3.3 Pipeline de Desligamento Escalonado (Graceful Shutdown)](#33-pipeline-de-desligamento-escalonado-graceful-shutdown)
   - [3.4 Pipeline de Auto-Religamento Inteligente (WoL & IPMI)](#34-pipeline-de-auto-religamento-inteligente-wol--ipmi)
   - [3.5 Pré-carregamento Rápido de VMs e Contentores (Prefetch & Cache)](#35-pré-carregamento-rápido-de-vms-e-contentores-prefetch--cache)
   - [3.6 Motor de Alertas com Cooldown Persistente](#36-motor-de-alertas-com-cooldown-persistente)
4. [Arquitetura de Software & Diagrama de Blocos](#-arquitetura-de-software--diagrama-de-blocos)
5. [Módulos & Componentes do Código-Fonte](#-módulos--componentes-do-código-fonte)
6. [Canais de Notificação & Alertas Suportados](#-canais-de-notificação--alertas-suportados)
7. [Instalação & Configuração em Produção (Guia Passo a Passo)](#-instalação--configuração-em-produção-guia-passo-a-passo)
   - [7.1 Pré-requisitos](#71-pré-requisitos)
   - [7.2 Instalação do Painel Principal (Flask / Python)](#72-instalação-do-painel-principal-flask--python)
   - [7.3 Instalação do Microsserviço WhatsApp (Baileys)](#73-instalação-do-microsserviço-whatsapp-baileys)
   - [7.4 Configuração de Serviços Systemd](#74-configuração-de-serviços-systemd)
   - [7.5 Rotas Estáticas de Rede (Netplan)](#75-rotas-estáticas-de-rede-netplan)
8. [Referência Completa da API REST](#-referência-completa-da-api-rest)
9. [Segurança, Auditoria & Boas Práticas](#-segurança-auditoria--boas-práticas)
10. [Histórico de Versões & Novidades da v2.0.0](#-histórico-de-versões--novidades-da-v200)

---

## 🌟 Visão Geral da Solução

O **Enging UPS Management & Automation System** é uma plataforma corporativa e industrial concebida para proteger infraestruturas críticas de TI e centros de dados alimentados por UPSs de topologia **Online Double Conversion**.

Em caso de perturbação ou corte total da rede elétrica da concessionária, a aplicação coordena o ciclo de vida completo da emergência:
1. **Monitoriza** em tempo real a telemetria elétrica da UPS (tensões, correntes, frequências, estado do inversor, barramento DC e autonomia das baterias).
2. **Notifica** instantaneamente os administradores através de múltiplos canais (WhatsApp, Microsoft Teams, Google Chat, Email e Webhooks).
3. **Executa** o encerramento ordenado e em cascata das cargas computacionais (VMs de desenvolvimento, bases de dados, servidores de virtualização Proxmox VE e VMware ESXi, e o próprio nó da UPS) antes do esgotamento das baterias.
4. **Religa automaticamente** os servidores físicos e máquinas virtuais assim que a energia AC retorna e as baterias atingem uma reserva segura e estável, utilizando pacotes mágicos **Wake-on-LAN (WoL)** e comandos remotos **IPMI / Redfish (iDRAC, SuperMicro, iLO)**.
5. **Persiste** todos os dados de telemetria, configurações, credenciais cifradas e registos de auditoria numa base de dados relacional **SQLite** com registo em diário **WAL**, garantindo imunidade total contra corrupção em falhas elétricas abruptas.

---

## 🎯 O Que o Sistema Faz

* **Sinóptico de Potência em Tempo Real**: Apresenta um diagrama unifilar animado via Server-Sent Events (SSE) ilustrando o trajeto elétrico instantâneo: *Rede AC &rarr; Retificador &rarr; Barramento DC & Baterias &rarr; Inversor & Bypass &rarr; Carga de Saída*.
* **Histórico Temporal de Telemetria**: Gravação contínua dos parâmetros elétricos para renderização gráfica instantânea (últimas 2h, 24h ou 7 dias) sem sobrecarga de memória RAM.
* **Orquestração Multiestágio de Desligamento**:
  * Definição de múltiplos planos independentes com diferentes limites de bateria (ex: Estágio 1 a 80%, Estágio 2 a 15%, Estágio 3 a 5%).
  * Contagem decrescente com carência ajustável (*grace period*) e botão de cancelamento de emergência.
  * Execução em modo real ou modo de simulação (**Dry-Run**) para validação sem impacto operacional.
* **Auto-Religamento Automático Pós-Restabelecimento**:
  * Deteção de transição para modo rede (*Line Mode / Online*).
  * Temporizador de estabilização da rede elétrica (ex: exige 120s de estabilidade contínua para evitar religamentos durante oscilações transitórias).
  * Envio sequencial de pacotes mágicos **Wake-on-LAN (UDP 9 broadcast)** e comandos **IPMI Chassis Power On** para os BMCs dedicados (ex: Dell iDRAC).
* **Gestor de Hipervisores & Inventário Rápido**:
  * Ligação direta a nós **Proxmox VE** (via SSH nativo com comandos otimizados de `/etc/pve`) e **VMware ESXi** (via SSH / `esxcli`).
  * Descoberta rápida de VMs (`qm list`) e Contentores LXC (`pct list`) com pré-carregamento em background (*prefetch*).
  * Bloqueio inteligente contra seleção duplicada da mesma VM em planos diferentes.
* **Microsserviço Dedicado de WhatsApp Multi-Device**:
  * Servidor Node.js embutido utilizando a biblioteca industrial `@whiskeysockets/baileys`.
  * Emparelhamento simples via QR Code renderizado no painel web.
  * Modal interativo com interface de chat, envio de mensagens manuais, histórico e mensagens de teste.
* **Auditoria Completa & Registo de Eventos**: Registo cronológico de todas as ações de shutdown, religamento, testes e notificações enviadas.

---

## ⚙️ Como o Sistema Funciona (Engenharia & Mecanismos)

### 3.1 Ciclo de Polling & Ingestão NUT
O núcleo da aplicação executa uma thread em background (`nut_polling_worker`) com intervalo nominal de 2 segundos:
1. Conecta-se via socket TCP local ou remoto (`127.0.0.1:3493`) ao serviço `upsd` do Network UPS Tools.
2. Emite comandos de baixo nível `LIST VAR <upsname>` e analisa os pares chave/valor devolvidos pelo driver `invt_modbus`.
3. Converte os valores brutos para tipos tipificados (float, int, string) e calcula grandezas derivadas (ex: potência ativa em Watts, fator de potência, percentual de carga, tempo estimado de autonomia).
4. Persiste o ponto de telemetria na tabela `telemetry_history` do SQLite e faz o broadcast para todos os clientes conectados via Server-Sent Events (`/api/stream`).

### 3.2 Motor de Base de Dados SQLite com WAL (`db.py`)
Para eliminar completamente a dependência de ficheiros JSON mantidos em memória RAM (suscetíveis a perda de dados durante cortes abruptos de energia), o sistema utiliza o motor de dados [`db.py`](file:///c:/Users/andre.gabry/Projects/NUT/db.py):
* **Modo WAL (Write-Ahead Logging)**: Configurado com `PRAGMA journal_mode=WAL;` e `PRAGMA synchronous=NORMAL;`. Leituras simultâneas não bloqueiam escritas, e as transações são gravadas diretamente no diário WAL em disco.
* **Isolamento de Threads**: Conexões geridas através de `threading.local()` para garantir total segurança de concorrência entre threads de polling, rotas da API Flask e tarefas de automação em background.
* **Migração Automática e Transparente**: No primeiro arranque, o método `migrate_from_json()` deteta automaticamente ficheiros legados (`users.json`, `connections_data.json`, `shutdown_plans.json`, `alerts_data.json`, `guests_cache.json`) e importa todas as informações para o SQLite sem intervenção manual.
* **Políticas de Retenção Automática**: Registos de telemetria antigos e históricos de logs são limpos periodicamente de forma automática, mantendo o ficheiro `ups_system.db` compacto e rápido.

### 3.3 Pipeline de Desligamento Escalonado (Graceful Shutdown)
Quando o nível de bateria atinge o limiar configurado num plano (e a UPS se encontra no estado `OB` - *On Battery*):
```
[Gatilho Bateria <= Limiar]
         │
         ▼
[Início da Carência (Grace Period Countdown)] ────► [Alerta de Contingência Disparado]
         │                                                     │
         ├──────────────────── Cancelado se energia voltar ou  │
         │                     se o operador abortar no painel │
         ▼
[Transição de Estado para RUNNING]
         │
         ├─► [Alvo 1: VMs não-críticas] ──► Delay configurado (ex: 0s)
         │       └─ Proxmox: qm shutdown <id> / pct shutdown <id>
         │       └─ VMware: vim-cmd vmsvc/power.shutdown <id>
         │
         ├─► [Alvo 2: VMs críticas / Bancos] ──► Delay configurado (ex: 30s)
         │
         ├─► [Alvo 3: Hipervisores Físicos] ──► Delay configurado (ex: 60s)
         │       └─ Proxmox: shutdown -h now
         │       └─ VMware: esxcli system shutdown poweroff
         │
         └─► [Alvo 4: Host Local da UPS] ──► Delay configurado (ex: 120s)
                 └─ shutdown -h now
```

### 3.4 Pipeline de Auto-Religamento Inteligente (WoL & IPMI)
Se a energia da concessionária retornar após um desligamento total ou parcial:
1. O sistema verifica se o estado da UPS mudou de `OB` (Em Bateria) para `OL` (Online).
2. Avalia a **histerese de bateria**: a carga da bateria deve ser superior à margem segura definida no plano (por exemplo, $\ge 85\%$ se o corte foi a 80%, ou $\ge 35\%$ se o corte foi a 15%).
3. Exige uma janela contínua de estabilidade de rede (por defeito 120 segundos). Se houver microcortes durante essa janela, o cronómetro reinicia.
4. Ao cumprir as condições, a thread `run_poweron_plan_async`:
   * Monta e transmite o pacote mágico **Wake-on-LAN** (16 repetições do endereço MAC precedidas por `0xFFFFFFFFFFFF`) para o IP de broadcast configurado (`255.255.255.255` ou broadcast de sub-rede).
   * Se o alvo possuir BMC configurado (iDRAC / SuperMicro / iLO), executa comando direto out-of-band via utilitário **`ipmitool`** (`ipmitool -I lanplus -H <ipmi_host> -U <user> -P <pass> chassis power on`).
   * Aguarda a inicialização do sistema operativo através de sondagem periódica à porta SSH (22).
   * Se houver VMs e contentores associados ao nó, conecta-se e executa os comandos de arranque correspondentes (`qm start <id>`, `pct start <id>`).

### 3.5 Pré-carregamento Rápido de VMs e Contentores (Prefetch & Cache)
Consultar listas de VMs via SSH em clusters de virtualização sob carga pode demorar vários segundos ou bloquear se o storage partilhado estiver ocupado. Para garantir uma interface instantânea ao adicionar alvos aos planos:
* O sistema possui uma thread dedicada (`GuestsPrefetcherThread`) que sonda os nós em segundo plano.
* Utiliza um script otimizado que lê diretamente os ficheiros canónicos de configuração localizados em `/etc/pve/qemu-server/*.conf` e cruza com a tabela de processos (`pgrep kvm`), respondendo em menos de 100ms.
* Os resultados são cacheados na tabela `guests_cache` do SQLite.

### 3.6 Motor de Alertas com Cooldown Persistente
O módulo [`alert_manager.py`](file:///c:/Users/andre.gabry/Projects/NUT/alert_manager.py) avalia regras como Falha de Rede AC, Restabelecimento, Bateria Baixa, Sobrecarga, Falha na UPS e Desconexão do Driver:
* **Cooldown Persistente**: Para evitar tempestades de mensagens (*alert fatigue*), cada regra possui um tempo de arrefecimento (ex: 10 min, 1440 min). O timestamp do último disparo é guardado na base de dados (`alert_rules.last_notified`), sobrevivendo a reinicializações do serviço.
* **Gatilhos de Duração**: O evento deve persistir por um número mínimo de segundos (ex: 2 a 5s) antes de ser considerado legítimo, prevenindo falsos positivos causados por ruídos elétricos.

---

## 🏗 Arquitetura de Software & Diagrama de Blocos

```mermaid
flowchart TD
    subgraph Hardware ["⚡ Camada Física de Potência & Infraestrutura"]
        UPS["UPS INVT HT1106XS\n6kVA / 6kW Double Conversion"]
        USB["Ligação USB Serial (/dev/ups-usb)"]
        UPS --> USB
    end

    subgraph CoreDaemon ["🐧 Camada de Comunicação & Drivers"]
        NUT["NUT Daemon (upsd :3493)\nDriver invt_modbus"]
        USB --> NUT
    end

    subgraph AppServer ["🚀 Enging Core Dashboard (10.255.255.28)"]
        Client["nut_client.py\n(Socket TCP Client)"]
        NUT --> Client

        Worker["nut_polling_worker\n(Polling a cada 2s)"]
        Client --> Worker

        DB[("ups_system.db\nSQLite (WAL Mode)\n14 Tabelas ACID")]
        Worker -->|Persiste Telemetria| DB

        Flask["app.py (Flask Web Framework)\nSSE Stream / Autenticação / REST API"]
        Worker -->|Difunde Eventos| Flask

        SM["shutdown_manager.py\nOrquestrador de Shutdown & WoL/IPMI"]
        AM["alert_manager.py\nMotor de Deduplicação & Cooldown"]
        CM["connections_manager.py\nHipervisores, Chaves API & Cache"]
        
        Worker --> SM
        Worker --> AM
        SM <--> DB
        AM <--> DB
        CM <--> DB
    end

    subgraph Gateways ["📢 Canais de Notificação"]
        WA_SRV["whatsapp_service (Node.js :3001)\nBiblioteca @whiskeysockets/baileys"]
        TEAMS["Microsoft Teams\n(Adaptive Cards 1.4)"]
        GCHAT["Google Chat\n(CardsV2 Webhook)"]
        SMTP["Servidor SMTP\n(M365 / Google / Relay)"]
        SMS["SMS Gateway\n(HTTP API / GSM)"]

        AM --> WA_SRV
        AM --> TEAMS
        AM --> GCHAT
        AM --> SMTP
        AM --> SMS
    end

    subgraph Targets ["🖥️ Infraestrutura Alvo (Virtualização & Hosts)"]
        PVE["Cluster Proxmox VE\n(SSH :22 / CLI Nativo)"]
        ESXI["Hipervisor VMware ESXi\n(SSH / esxcli / API)"]
        BMC["iDRAC / IPMI BMC\n(Out-of-band Power On)"]
        LOCAL["Host Local NUT\n(10.255.255.28)"]

        SM -->|Graceful Shutdown via SSH| PVE
        SM -->|Graceful Shutdown via SSH| ESXI
        SM -->|Wake-on-LAN UDP 9| PVE
        SM -->|Wake-on-LAN UDP 9| ESXI
        SM -->|IPMI Power On| BMC
        SM -->|Desligamento Final| LOCAL
    end
```

---

## 📦 Módulos & Componentes do Código-Fonte

| Ficheiro / Módulo | Linhas | Responsabilidade Primária |
| :--- | :---: | :--- |
| [`db.py`](file:///c:/Users/andre.gabry/Projects/NUT/db.py) | ~940 | Motor central SQLite (Singleton, WAL mode, thread-local, schema DDL, migração JSON, retenção e índices). |
| [`app.py`](file:///c:/Users/andre.gabry/Projects/NUT/app.py) | ~660 | Servidor web Flask, autenticação com sessão segura, rotas da UI, Server-Sent Events (`/api/stream`) e API REST. |
| [`nut_client.py`](file:///c:/Users/andre.gabry/Projects/NUT/nut_client.py) | ~250 | Cliente de protocolo NUT via TCP socket, comandos `LIST VAR`, sanitização de valores e cálculo de métricas. |
| [`shutdown_manager.py`](file:///c:/Users/andre.gabry/Projects/NUT/shutdown_manager.py) | ~970 | Orquestrador de planos de contingência, carência, execução paralela/sequencial de SSH, WoL e IPMI. |
| [`connections_manager.py`](file:///c:/Users/andre.gabry/Projects/NUT/connections_manager.py) | ~1040 | Gestão de credenciais de hipervisores Proxmox/VMware, chaves de API REST e thread de prefetch de VMs/CTs. |
| [`alert_manager.py`](file:///c:/Users/andre.gabry/Projects/NUT/alert_manager.py) | ~1690 | Central de regras de alerta, temporizadores de histerese, cooldown persistente e despachante multicanal. |
| [`auth_manager.py`](file:///c:/Users/andre.gabry/Projects/NUT/auth_manager.py) | ~60 | Camada de autenticação delegada ao SQLite, validação de hashes criptográficos (`scrypt`/`pbkdf2`). |
| [`config.py`](file:///c:/Users/andre.gabry/Projects/NUT/config.py) | ~30 | Variáveis de ambiente, caminhos, chaves secretas de sessão e parâmetros de conexão ao NUT. |
| [`whatsapp_service/server.js`](file:///c:/Users/andre.gabry/Projects/NUT/whatsapp_service/server.js) | ~400 | Microsserviço independente Node.js com Baileys Multi-Device, geração de QR Code e endpoints HTTP REST. |
| [`deploy_to_server.py`](file:///c:/Users/andre.gabry/Projects/NUT/deploy_to_server.py) | ~80 | Utilitário de automação de implantação via SSH e SFTP para o servidor de produção (`10.255.255.28`). |
| [`static/js/app.js`](file:///c:/Users/andre.gabry/Projects/NUT/static/js/app.js) | ~2400 | Aplicação SPA em JavaScript puro: SSE, renderização de cards, modais, sinóptico animado e gestão de planos. |

---

## 📢 Canais de Notificação & Alertas Suportados

1. **WhatsApp Multi-Device (Nativo via Baileys)**:
   * Conexão por socket persistente diretamente aos servidores do WhatsApp sem necessidade de serviços externos pagos (como Twilio ou Z-API).
   * Sessão criptografada guardada localmente em `whatsapp_service/auth_info_baileys/`.
   * Envio imediato com prioridade alta e formatação rica com emojis e dados dinâmicos da falha.
2. **Microsoft Teams**:
   * Formatação em **Adaptive Cards 1.4** com cabeçalhos de cores adaptativas (*Attention, Warning, Good*).
   * Grelha estruturada (*FactSet*) com tensão de entrada, carga da UPS, bateria e horário de ocorrência.
3. **Google Chat**:
   * Payload estruturado no padrão **CardsV2**, com secções colapsáveis, ícones temáticos e botões de ação rápida para acesso ao painel.
4. **Email Corporativo (SMTP)**:
   * Envio de emails em HTML responsivo e texto puro com suporte a **STARTTLS** e **SSL/TLS**.
   * Presets prontos para Microsoft 365 (`smtp.office365.com:587`), Google Workspace (`smtp.gmail.com:587`) e Relays Internos.
   * Suporte para personalização de `From Name`, `From Email` e `Reply-To`.
5. **Webhooks Customizados & SIEM**:
   * Envio de payloads JSON com cabeçalhos HTTP customizados (`Authorization`, `X-API-Key`, etc.).
   * Integração direta com Zabbix, Grafana Loki, Discord, Slack ou Elasticsearch.
6. **SMS Gateway Industrial**:
   * Suporte a gateways HTTP com métodos `GET` ou `POST` parametrizáveis para envio via modems GSM industriais.

---

## 🛠 Instalação & Configuração em Produção

### 7.1 Pré-requisitos
* Sistema Operativo: **Ubuntu 22.04 LTS / 24.04 LTS** ou **Debian 12**
* Python **3.10** ou superior com `python3-venv` e `python3-pip`
* Node.js **18.x** ou superior e `npm`
* Pacotes do sistema: `nut`, `nut-client`, `nut-server`, `ipmitool`, `wakeonlan`
* Acesso à porta USB onde a UPS está conectada (`/dev/ups-usb` ou driver correspondente)

```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip nodejs npm ipmitool wakeonlan curl git
```

### 7.2 Instalação do Painel Principal (Flask / Python)
```bash
# 1. Criar a pasta de produção
sudo mkdir -p /opt/nut-dashboard
sudo chown -R $USER:$USER /opt/nut-dashboard
cd /opt/nut-dashboard

# 2. Clonar o projeto
git clone https://github.com/andregabry/NUT-Panel.git .

# 3. Criar e ativar o ambiente virtual Python
python3 -m venv venv
source venv/bin/activate

# 4. Instalar as dependências
pip install --upgrade pip
pip install -r requirements.txt
```

### 7.3 Instalação do Microsserviço WhatsApp (Baileys)
```bash
cd /opt/nut-dashboard/whatsapp_service
npm install --omit=dev
```

### 7.4 Configuração de Serviços Systemd

#### Serviço 1: Painel Web & Core Engine (`/etc/systemd/system/nut-dashboard.service`)
```ini
[Unit]
Description=Enging UPS Management & Automation System (Core Engine)
After=network.target nut-server.service
Wants=nut-server.service

[Service]
Type=simple
User=enging
Group=enging
WorkingDirectory=/opt/nut-dashboard
ExecStart=/opt/nut-dashboard/venv/bin/python app.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

#### Serviço 2: Microsserviço WhatsApp (`/etc/systemd/system/nut-whatsapp.service`)
```ini
[Unit]
Description=Enging UPS WhatsApp Web Microservice (Baileys MD)
After=network.target

[Service]
Type=simple
User=enging
Group=enging
WorkingDirectory=/opt/nut-dashboard/whatsapp_service
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3001
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Ativação e arranque dos serviços:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nut-dashboard.service
sudo systemctl enable --now nut-whatsapp.service
sudo systemctl status nut-dashboard.service nut-whatsapp.service
```

### 7.5 Rotas Estáticas de Rede (Netplan)
Se o servidor do painel estiver numa sub-rede de gestão (ex: `10.255.255.28/24`) e precisar de comunicar com nós Proxmox/VMware noutras VLANs (ex: `192.168.4.0/23`, `192.168.10.0/23` ou redes BMC `10.255.255.209`), configure as rotas no Netplan (`/etc/netplan/50-cloud-init.yaml`):

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens192:
      dhcp4: false
      addresses:
        - 10.255.255.28/24
      routes:
        - to: default
          via: 10.255.255.254
          metric: 100
        - to: 192.168.4.0/23
          via: 10.255.255.251
        - to: 192.168.10.0/23
          via: 10.255.255.251
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
```
Aplique as alterações com:
```bash
sudo netplan apply
```

---

## 📡 Referência Completa da API REST

A API REST do sistema permite a integração bidirecional com sistemas de monitorização de terceiros (Grafana, Zabbix, Home Assistant, Prometheus, Nagios).

Para autenticação, passe o cabeçalho:
```http
Authorization: Bearer <SEU_TOKEN_API>
Content-Type: application/json
```

### Tabela de Endpoints

| Método | Endpoint | Permissão | Descrição |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/status` | `read` | Retorna o payload completo com status da UPS, métricas, planos ativos e alarmes. |
| `GET` | `/api/history?limit=120` | `read` | Consulta a tabela `telemetry_history` do SQLite com os últimos pontos de telemetria. |
| `GET` | `/api/stream` | `read` | Fluxo em tempo real via Server-Sent Events (SSE) a cada 2 segundos. |
| `GET` | `/api/plans` | `read` | Lista todos os planos de desligamento e histórico de auditoria. |
| `POST`| `/api/plans` | `write` | Cria ou edita um plano de desligamento e alvos associados. |
| `DELETE`| `/api/plans/<id>` | `write` | Remove um plano de desligamento e os respetivos alvos. |
| `POST`| `/api/plans/<id>/run` | `write` | Inicia manualmente um plano (suporta parâmetro `dry_run: true`). |
| `POST`| `/api/plans/<id>/poweron` | `write` | Aciona manualmente a rotina de auto-religamento (WoL + IPMI) dos alvos. |
| `POST`| `/api/plans/<id>/cancel` | `write` | Aborta imediatamente uma contagem decrescente em curso. |
| `GET` | `/api/alerts` | `read` | Lista regras de alerta, configurações de canais, destinatários e histórico de envios. |
| `POST`| `/api/alerts/rule` | `write` | Cria ou atualiza uma regra de alerta (com cooldown e canais). |
| `POST`| `/api/alerts/test` | `write` | Executa envio de mensagem de teste para canal/destinatário selecionado. |
| `GET` | `/api/connections` | `read` | Retorna servidores Proxmox, VMware, NUT e chaves API registadas. |
| `GET` | `/api/connections/proxmox/<id>/guests` | `read` | Retorna inventário rápido em cache de VMs e Contentores LXC do Proxmox. |
| `GET` | `/api/connections/vmware/<id>/guests` | `read` | Retorna inventário em cache de VMs hospedadas no VMware ESXi. |

#### Exemplo de Chamada: Telemetria da UPS (`GET /api/status`)
```bash
curl -s -H "Authorization: Bearer eng_live_xxxxxxxxxxxxxxxx" https://10.255.255.28/api/status
```
**Resposta JSON**:
```json
{
  "connected": true,
  "status_code": "OL",
  "status_label": "Online (Rede AC Normal)",
  "timestamp": 1794830300.5,
  "formatted_time": "2026-11-17 10:38:20",
  "battery": {
    "charge_pct": 100.0,
    "voltage": 218.4,
    "runtime_sec": 7200
  },
  "input": {
    "voltage": 231.2,
    "frequency_hz": 50.01,
    "current_a": 4.8
  },
  "output": {
    "voltage": 230.0,
    "load_pct": 18.0,
    "real_power_w": 1080.0,
    "apparent_power_va": 1150.0
  },
  "ups": {
    "model": "INVT HT1106XS",
    "temperature_c": 28.0,
    "power_factor": 0.94
  },
  "alarms": []
}
```

---

## 🔒 Segurança, Auditoria & Boas Práticas

1. **Armazenamento Seguro de Credenciais**:
   * As palavras-passe de utilizador são geradas com hash criptográfico salgado (`scrypt` / `pbkdf2:sha256`).
   * As chaves privadas SSH e palavras-passe de acesso a hipervisores na interface web são mascaradas (`••••••••`) para prevenir visualização acidental.
2. **Execução Privilegiada Segura**:
   * Comandos locais de desligamento utilizam regras restritas no `sudoers` sem necessidade de expor shell de superutilizador desprotegida.
3. **Resiliência a Falhas Físicas**:
   * O diário WAL do SQLite previne corrupções na base de dados mesmo na eventualidade do host sofrer um *hard power cut*.
   * Todas as configurações são persistidas em disco imediatamente a cada alteração.

---

## 🏷 Histórico de Versões & Novidades da v2.0.0

### **Versão 2.0.0 (Major Release)** - *Novembro 2026*
* **Nova Arquitetura de Dados em SQLite WAL (`ups_system.db`)**:
  * Substituição completa de todos os ficheiros JSON e arrays voláteis em memória por um banco relacional robusto com modo WAL ativo.
  * Migração automática de dados existentes no arranque (`migrate_from_json`).
* **Mecanismo de Auto-Religamento Inteligente (Auto-PowerOn)**:
  * Suporte nativo a **Wake-on-LAN (Magic Packet)** para religar servidores físicos via rede.
  * Suporte nativo a comandos **IPMI Chassis Power On** para servidores com iDRAC (Dell PowerEdge) e BMCs dedicados.
  * Temporizador de histerese e estabilidade de rede AC para prevenir ciclos repetitivos de liga/desliga.
* **Integração com Hipervisores VMware ESXi**:
  * Suporte para desligamento ordenado de nós e máquinas virtuais VMware ESXi via SSH e `esxcli`.
* **Pré-carregamento Rápido de VMs e Contentores**:
  * Motor híbrido de varredura que lê diretamente os ficheiros canónicos de `/etc/pve`, eliminando esperas e latências no carregamento da lista de VMs.
* **Persistência de Cooldown de Alertas**:
  * O timestamp de último envio é registado no SQLite, resolvendo o problema de falsos disparos de alertas no reinício do serviço.
* **Microsserviço de WhatsApp Web (Baileys MD)**:
  * Integração completa com emparelhamento por QR Code e consola de chat ao vivo no painel web.
* **Refinamento da Interface Visual**:
  * Limpeza de blocos duplicados de parâmetros e reorganização dos cartões métricos do plano de contingência.

---

<div align="center">
  <p>© 2026 <strong>Enging - Make Solutions</strong>. Todos os direitos reservados.</p>
  <p><em>Inovação, Monitorização Preditiva e Engenharia de Proteção de Infraestruturas.</em></p>
</div>
