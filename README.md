# ⚡ Enging UPS Management & Automation System

<div align="center">
  <img src="static/img/logo-horizontal.png" alt="Enging Logo" width="300" />
  <p><strong>Plataforma Centralizada de Monitorização em Tempo Real, Automação de Infraestrutura e Gestão de Alertas para UPS Industriais</strong></p>
  <p><em>Desenvolvido para UPS <strong>INVT HT1106XS (6kVA / 6kW Online Double Conversion)</strong> & Integração Multi-Nó (Proxmox VE via SSH & VMware ESXi)</em></p>
</div>

---

## 📋 Índice

1. [Visão Geral](#-visão-geral)
2. [Arquitetura do Sistema](#-arquitetura-do-sistema)
3. [Funcionalidades Principais](#-funcionalidades-principais)
   - [Diagrama Sinóptico de Fluxo de Energia](#1-diagrama-sinóptico-de-fluxo-de-energia)
   - [Orquestrador de Desligamento Automatizado (Graceful Shutdown)](#2-orquestrador-de-desligamento-automatizado-graceful-shutdown)
   - [Central Multicanal de Alertas & Notificações](#3-central-multicanal-de-alertas--notificações)
   - [API RESTful v1 Integrada](#4-api-restful-v1-integrada)
4. [Módulos & Microsserviços](#-módulos--microsserviços)
5. [Instalação & Configuração em Produção](#-instalação--configuração-em-produção)
   - [Pré-requisitos do Sistema](#pré-requisitos)
   - [Configuração do Serviço Web (Python/Flask)](#configuração-do-serviço-web-pythonflask)
   - [Configuração do Microsserviço WhatsApp (Baileys MD)](#configuração-do-microsserviço-whatsapp-baileys-md)
   - [Configuração dos Serviços Systemd](#configuração-dos-serviços-systemd)
6. [Configurações de Rede & Rotas Estáticas](#-configurações-de-rede--rotas-estáticas)
7. [Referência da API REST](#-referência-da-api-rest)
8. [Estrutura de Ficheiros do Projeto](#-estrutura-de-ficheiros-do-projeto)
9. [Licença e Créditos](#-licença-e-créditos)

---

## 🌟 Visão Geral

O **Enging UPS Management & Automation System** é uma solução corporativa para monitorização em tempo real, automação e orquestração de emergência para sistemas de alimentação ininterrupta (UPS / No-Break).

O sistema comunica diretamente com o **NUT (Network UPS Tools)** e o driver `invt_modbus` conectado via USB (`/dev/ups-usb`), expondo métricas elétricas instantâneas, diagramas de fluxo de potência em tempo real (SSE), planos de desligamento de servidores virtualizados (Proxmox VE e VMware ESXi) e notificações multicanal instantâneas (WhatsApp, Microsoft Teams, Google Chat, SMS e SMTP).

---

## 🏗 Arquitetura do Sistema

```
                      +------------------------------------------+
                      |         UPS INVT HT1106XS (6kVA)         |
                      |   Online Double Conversion (Modbus USB)  |
                      +--------------------+---------------------+
                                           |
                                 [/dev/ups-usb]
                                           |
                      +--------------------+---------------------+
                      |       NUT Daemon (upsd / port 3493)      |
                      +--------------------+---------------------+
                                           |
                      +--------------------+---------------------+
                      |   Enging Core Engine (Python / Flask)    |
                      |     - Server-Sent Events (SSE Stream)    |
                      |     - Regras de Alerta & Deduplicação    |
                      |     - Orquestrador de Shutdown (SSH/API) |
                      |     - REST API v1 (Bearer Token Auth)    |
                      +----------+-------------------+-----------+
                                 |                   |
            +--------------------+---+           +---+--------------------+
            | Microserviço WhatsApp  |           | Gateways de Notificação|
            | (Node.js / Baileys MD) |           | - Microsoft Teams Card |
            |      [Porta 3001]      |           | - Google Chat CardsV2  |
            +------------------------+           | - Webhooks Genéricos   |
                                                 | - SMS Gateway API      |
                                                 | - SMTP (Office 365)    |
                                                 +------------------------+
                                 |
            +--------------------+-------------------+
            | Infraestrutura Gerida (Shutdown Auto)  |
            | - Nós Proxmox VE (via SSH CLI Nativo)  |
            | - Hipervisores VMware ESXi (CLI/API)   |
            +----------------------------------------+
```

---

## 🚀 Funcionalidades Principais

### 1. Diagrama Sinóptico de Fluxo de Energia
- **Visualização Dinâmica em Tempo Real**: Trajeto elétrico ativo com animações de pulso luminoso diferenciadas para:
  - **Rede Elétrica (Mains AC)**: Tensão RMS, Corrente, Frequência (Hz) e Fator de Potência (PF).
  - **Retificador & Carregador**: Estado operacional e fluxo DC para baterias.
  - **Banco de Baterias**: Percentual de carga residual, Tensão DC do barramento e Corrente de carga/descarga.
  - **Inversor & Modo Bypass**: Indicação instantânea de Bypass Ativo vs Inversor Online.
  - **Carga de Saída (Output AC)**: Percentual de carga (%), Potência Aparente (VA) e Potência Ativa (W).
- **Tempo Real com SSE (Server-Sent Events)**: Atualização a cada 2 segundos sem polling excessivo no browser.

### 2. Orquestrador de Desligamento Automatizado (Graceful Shutdown)
- **Modos de Operação**:
  - **Automático**: Disparo programado com base no nível crítico de bateria ou perda prolongada de rede elétrica.
  - **Manual**: Execução de planos de contingência com um clique a partir do painel.
- **Suporte Proxmox VE via SSH Nativo**:
  - Comunicação segura via SSH (Porta 22 com Palavra-passe ou Chave Privada RSA/Ed25519).
  - Deteção e inventário automático de Máquinas Virtuais (`qm list`) e Contentores LXC (`pct list`).
  - Sequenciamento por prioridade (Stage 1: VMs não críticas -> Stage 2: VMs críticas/BD -> Stage 3: Shutdown do Host Proxmox `shutdown -h now`).
- **Suporte VMware ESXi**:
  - Deteção de VMs e encerramento ordenado via comandos `esxcli`.
- **Prevenção de Falsos Positivos**: Cooldown de segurança e cancelamento manual durante a contagem decrescente.

### 3. Central Multicanal de Alertas & Notificações
- **WhatsApp Multi-Device (Baileys MD)**:
  - Gestão de múltiplas contas/sessões simultâneas com persistência de credenciais em disco.
  - Modal interativo com interface de chat completa, histórico de mensagens e envio de mensagens de teste em tempo real.
  - Alertas com formatação rica e marcadores dinâmicos (`{ups_name}`, `{battery_charge}`, `{input_voltage}`, `{output_load}`, `{event_time}`).
- **Microsoft Teams (Adaptive Cards 1.4)**:
  - Layout corporativo com cartão estruturado, cabeçalho colorido por severidade (Crítico: Laranja/Vermelho, Aviso: Amarelo, Normal: Verde).
  - Grelha detalhada de métricas e deduplicação inteligente de eventos.
- **Google Chat (CardsV2)**:
  - Integração com espaços do Google Workspace via webhook no formato CardsV2.
- **Webhooks Genéricos & SIEM**:
  - Envio de payloads JSON com cabeçalhos de autenticação customizáveis (`Bearer`, `Basic`, `ApiKey`).
- **SMS Gateway**:
  - Integração HTTP GET/POST com provedores GSM / Gateways de SMS industriais.
- **Email (SMTP)**:
  - Suporte completo para Microsoft 365, Google Workspace e servidores de correio internos com STARTTLS / SSL.

### 4. API RESTful v1 Integrada
- Autenticação por **Bearer Token** (`Bearer eng_live_...`).
- Suporte a geração, revogação e rotação de chaves de API com controlo de permissões (`read`, `write`, `admin`).
- Endpoints completos para ingestão em sistemas de terceiros (Zabbix, Grafana, Home Assistant, Prometheus).

---

## 📦 Módulos & Microsserviços

| Ficheiro | Responsabilidade |
| :--- | :--- |
| `app.py` | Servidor web Flask principal, rotas de visualização, SSE stream e endpoints REST API. |
| `nut_client.py` | Cliente de comunicação TCP com o protocolo de rede do NUT daemon (`upsd:3493`). |
| `shutdown_manager.py` | Orquestrador de sequências de desligamento, estágios e execução remota SSH. |
| `connections_manager.py`| Gestor de conexões aos nós Proxmox VE (SSH), VMware e chaves de API REST. |
| `alert_manager.py` | Motor de avaliação de regras de alerta, cooldown e dispatch para gateways. |
| `auth_manager.py` | Controlo de sessões web, autenticação multi-utilizador e hash de passwords com salt. |
| `whatsapp_service/server.js` | Microsserviço Node.js independente baseado na biblioteca `@whiskeysockets/baileys`. |
| `deploy_to_server.py` | Script de automação e implantação remota via SSH/SFTP para o servidor de produção. |

---

## 🛠 Instalação & Configuração em Produção

### Pré-requisitos
- Ubuntu Server 22.04 LTS / 24.04 LTS ou Debian 12
- Python 3.10+ com `pip` e `venv`
- Node.js 18+ e `npm`
- Servidor NUT (`nut-server`, `nut-client`) configurado com driver `invt_modbus`

### Configuração do Serviço Web (Python/Flask)
```bash
# 1. Clonar o repositório para o diretório de destino
sudo mkdir -p /opt/nut-dashboard
sudo chown -R $USER:$USER /opt/nut-dashboard
cd /opt/nut-dashboard

# 2. Criar ambiente virtual e instalar dependências Python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Configuração do Microsserviço WhatsApp (Baileys MD)
```bash
# Entrar no diretório do serviço WhatsApp
cd /opt/nut-dashboard/whatsapp_service

# Instalar pacotes npm
npm install
```

### Configuração dos Serviços Systemd

#### 1. Serviço Web Flask (`/etc/systemd/system/nut-dashboard.service`)
```ini
[Unit]
Description=Enging UPS Dashboard & Core Management System
After=network.target nut-server.service

[Service]
Type=simple
User=enging
WorkingDirectory=/opt/nut-dashboard
ExecStart=/opt/nut-dashboard/venv/bin/python app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

#### 2. Serviço WhatsApp (`/etc/systemd/system/nut-whatsapp.service`)
```ini
[Unit]
Description=Enging UPS WhatsApp Baileys MD Microservice
After=network.target

[Service]
Type=simple
User=enging
WorkingDirectory=/opt/nut-dashboard/whatsapp_service
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
```

```bash
# Recarregar systemd e ativar os serviços
sudo systemctl daemon-reload
sudo systemctl enable --now nut-dashboard.service
sudo systemctl enable --now nut-whatsapp.service
```

---

## 🌐 Configurações de Rede & Rotas Estáticas

Para permitir que o servidor da aplicação (`10.255.255.28/24`) comunique com nós de virtualização e infraestrutura localizados em sub-redes internas como `192.168.4.0/23`, certifique-se de configurar a rota estática persistente no Netplan (`/etc/netplan/50-cloud-init.yaml`):

```yaml
network:
  version: 2
  ethernets:
    ens18:
      addresses:
        - 10.255.255.28/24
      routes:
        - to: default
          via: 10.255.255.1
        - to: 192.168.4.0/23
          via: 10.255.255.251
      nameservers:
        addresses:
          - 1.1.1.1
          - 8.8.8.8
```

Aplicar alterações de rede:
```bash
sudo netplan apply
```

---

## 📡 Referência da API REST

Todas as chamadas à API requerem o cabeçalho HTTP:
```http
Authorization: Bearer <SEU_TOKEN_API>
Content-Type: application/json
```

### Endpoints Principais

| Método | Endpoint | Descrição |
| :--- | :--- | :--- |
| `GET` | `/api/v1/ups/live` | Retorna o estado completo da UPS, métricas elétricas e alarmes ativos. |
| `GET` | `/api/v1/ups/variables` | Retorna a totalidade dos dados brutos disponibilizados pelo driver Modbus. |
| `GET` | `/api/v1/shutdown/status` | Retorna o status de contingência e progresso do plano de desligamento. |
| `POST`| `/api/v1/shutdown/execute` | Inicia manualmente um plano de desligamento orquestrado. |
| `POST`| `/api/v1/shutdown/abort` | Cancela imediatamente uma sequência de desligamento em contagem. |
| `POST`| `/api/v1/alerts/test` | Dispara uma mensagem de teste para o gateway especificado. |
| `GET` | `/api/v1/connections/proxmox/test` | Valida conectividade SSH com nós Proxmox configurados. |

#### Exemplo de Resposta (`GET /api/v1/ups/live`):
```json
{
  "status": "online",
  "battery_charge": 100,
  "battery_voltage": 218.4,
  "input_voltage": 230.1,
  "input_frequency": 50.0,
  "output_voltage": 230.0,
  "output_load": 18,
  "output_power_w": 1080,
  "output_power_va": 1150,
  "temperature": 27.5,
  "alarms": [],
  "ups_status_raw": "OL"
}
```

---

## 🗂 Estrutura de Ficheiros do Projeto

```
NUT/
├── alert_manager.py             # Motor de alertas e integrações
├── app.py                       # Aplicação principal Flask
├── auth_manager.py              # Gestão de utilizadores e sessões
├── config.py                    # Ficheiro central de configurações
├── connections_manager.py       # Gestão de Proxmox SSH, VMware & Tokens API
├── deploy_to_server.py          # Script de deploy automatizado via SFTP/SSH
├── nut_client.py                # Cliente de baixo nível NUT TCP
├── shutdown_manager.py          # Motor de encerramento orquestrado de nós
├── requirements.txt             # Dependências Python
├── static/
│   ├── css/
│   │   └── style.css            # Estilos personalizados e tema Enging
│   ├── js/
│   │   └── app.js               # Lógica de interface, SSE e WebSockets
│   └── img/
│       ├── logo-horizontal.png
│       └── logo-vertical.png
├── templates/
│   ├── index.html               # Interface principal de gestão
│   └── login.html               # Ecrã de autenticação
└── whatsapp_service/
    ├── package.json             # Dependências Node.js
    └── server.js                # Servidor Baileys Multi-Device
```

---

<div align="center">
  <p>© 2026 <strong>Enging - Make Solutions</strong>. Todos os direitos reservados.</p>
</div>
