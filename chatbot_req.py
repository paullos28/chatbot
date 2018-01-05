import requests
import os
from xml.etree import ElementTree
import datetime

#DEFINIÇÃO DE VARIAVEIS
menu = {}
global apy_key
global url
global payload
global headers
global opcoes_menu

# PARAMETROS PARA CONEXÃO VIA API COM O UPTIME ROBOT
api_key = 'u386965-8e5fc8a74a1817c4b0c7ff9e'
url = "https://api.uptimerobot.com/v2/getMonitors"
payload = "format=xml&logs=1&logs_limit=1&timezone=1" + '&api_key=' + api_key
headers = {'content-type': "application/x-www-form-urlencoded", 'cache-control': "no-cache"}

# FUNÇÃO QUE BUSCA OS MONITORES CADASTRADOS NO UPTIME ROBOT
def getmonitor(url, payload, headers, sys=None):
    if sys != None:
        payload += sys
    try:
        dom = ElementTree.fromstring(requests.request("POST", url, data=payload, headers=headers).text)
        list = dom.findall('monitor')
        list2 = dom.findall('monitor/logs')

        c = 0
        while c < len(list):
            print('Sistema:', list[c].get('friendly_name'))
            print('URL:', list[c].get('url'))
            print('Status: ONLINE') if list2[c].find('log').get('type') == '2' else print('Status: OFFLINE')
            print('Desde:', datetime.datetime.fromtimestamp(int(list2[c].find('log').get('datetime'))))
            print('**********************')
            c += 1

    except:
        print('Um erro ocorreu na consulta aos logs. Favor tentar mais tarde!')
        exit()


# ************************************

# FUNÇÃO QUE BUSCA OS MONITORES CADASTRADOS NO UPTIME ROBOT
def getsistema(url, payload, headers, sys=None):
    if sys != None:
        payload += sys

    try:
        dom = ElementTree.fromstring(requests.request("POST", url, data=payload, headers=headers).text)
        list = dom.findall('monitor')
        return list
    except:
        print('Um erro ocorreu na consulta aos logs. Favor tentar mais tarde!')
        exit()


# ************************************

def gera_menu():
    opcoes_menu = getsistema(url, payload, headers)
    n = 1
    for x in opcoes_menu:
        menu[n] = x.get('friendly_name')
        n += 1
    menu[n] = 'Todos'
    return escolha_menu()

def escolha_menu():
    print('-----------------------------\n\nMenu')
    for x in menu:
        print(x, ' - ', menu[x])
    escolha = int(input('Escolha: '))
    if escolha in menu.keys():
        return menu[escolha]
    else:
        print('Escolha invalida, tente novamente')
        escolha_menu()


while True:
    sistema = gera_menu()
    getmonitor(url, payload, headers, '&search=' + sistema) if sistema != 'Todos' else getmonitor(url, payload, headers)

    escolha = str(input('Pesquisar novamente <s/n>?  '))

    if escolha != 'S':
        exit()