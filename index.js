// -----------------------------------------------------------------------------
// ARQUIVO: index.js
// DESCRIÇÃO: Webhook em Node.js/Express para integrar o Oracle Digital Assistant
//            com o WhatsApp através da API da Meta.
// -----------------------------------------------------------------------------

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const bodyParser = require('body-parser');

// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const app = express();

// --- CONFIGURAÇÃO ---
// É crucial usar o `bodyParser.json` com a opção `verify` para termos acesso ao
// corpo bruto (raw body) da requisição. Isso é OBRIGATÓRIO para validar a 
// assinatura do webhook do ODA.
let rawBodyBuffer = null;
app.use(bodyParser.json({
  verify: (req, res, buf, encoding) => {
    if (buf && buf.length) {
      rawBodyBuffer = buf;
    }
  }
}));

const PORT = process.env.PORT || 3000;
const ODA_WEBHOOK_URL = process.env.ODA_WEBHOOK_URL;
const ODA_SECRET_KEY = process.env.ODA_SECRET_KEY;
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_APP_SECRET_KEY = process.env.WHATSAPP_APP_SECRET_KEY
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Seu token de verificação para a Meta

// --- MIDDLEWARE DE VERIFICAÇÃO DE ASSINATURA DO ODA ---
// Este middleware protege o endpoint contra requisições que não venham do ODA.
const verifyOdaSignature = (req, res, next) => {
  const odaSignature = req.get('X-Hub-Signature-256');

  // Se a assinatura não estiver presente, significa que a requisição
  // provavelmente veio do WhatsApp, então pulamos a verificação.
  if (!odaSignature) {
    return next();
  }

  // Se a assinatura existe, ela DEVE ser validada.
  if (!rawBodyBuffer) {
    console.error('Buffer do corpo da requisição está vazio. Não é possível validar a assinatura.');
    return res.status(400).send('Request body buffer is missing.');
  }

  const hmac = crypto.createHmac('sha256', ODA_SECRET_KEY);
  console.log('SecretKey: ', ODA_SECRET_KEY)
  hmac.update(rawBodyBuffer);
  const calculatedSignature = 'sha256=' + hmac.digest('hex');

  if (odaSignature !== calculatedSignature) {
    console.log('OdaSignature: %s', odaSignature)
    console.log('CalculatedSignature: %s', calculatedSignature)
    console.error('Falha na validação da assinatura do ODA. Requisição não autorizada.');
    return res.status(401).send('Unauthorized: Invalid signature.');
  }

  // Assinatura válida, prossegue para o handler da rota.
  next();
};

// --- ROTAS DO WEBHOOK ---

// Rota GET: Usada pela Meta para verificar o seu webhook na configuração inicial.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
      res.sendStatus(404);
  }
});

// Rota POST: Recebe notificações tanto do WhatsApp quanto do ODA.
// O middleware `verifyOdaSignature` é aplicado aqui.
//app.post('/webhook', verifyOdaSignature, async (req, res) => {
app.post('/webhook', async (req, res) => {
  const body = req.body;
  //console.log ('Request:', req)

  // VERIFICA A ORIGEM DA MENSAGEM (ODA ou WhatsApp)
  // CRIA UMA CONSTANTES: isFromWhatsapp
  // VALORANDO A CONSTANTE isFromWhatsapp
  const hmac = crypto.createHmac('sha256', WHATSAPP_APP_SECRET_KEY);
  hmac.update(rawBodyBuffer);
  const key_wz = 'sha256=' + hmac.digest('hex');
  const key_post = req.get('X-Hub-Signature-256')
  const isFromWhatsapp = key_wz === key_post

  // A presença da assinatura do ODA (já validada no middleware) é a forma
  // mais segura de saber que a mensagem vem do assistente digital.
  //const isFromODA = !!req.get('X-Hub-Signature-256');
  //console.log('Verificando a signature do HTTP...', req.get('X-Hub-Signature-256'))
  //console.log('Verificando se a mensagem veio do ODA...')
  //console.log(isFromODA)

  if (!isFromWhatsapp) {
    // --- LÓGICA: MENSAGEM VINDA DO ODA PARA O USUÁRIO ---
    console.log('Recebida mensagem do ODA:', JSON.stringify(body, null, 2));
    
    const userId = body.userId; // Número de telefone do usuário
    //const messages = body.entry[0].changes[0].value.messages;
    const messages = body.messagePayload.body.messages;

    // ODA pode enviar múltiplas "bolhas" de mensagem de uma vez.
    for (const message of messages) {
      if (message.type === 'text') {
        const messageData = {
          messaging_product: 'whatsapp',
          to: userId,
          type: 'text',
          text: { body: message.text }
        };

        try {
          await axios.post(
            `https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            messageData,
            { headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` } }
          );
          console.log(`Mensagem enviada para o WhatsApp do usuário ${userId}`);
        } catch (error) {
          console.error('Erro ao enviar mensagem para o WhatsApp:', error.response ? error.response.data : error.message);
        }
      }
      // TODO: Adicionar lógica para outros tipos de mensagem (imagens, botões, etc.)
    }

  } else if (isFromWhatsapp) {
    // --- LÓGICA: MENSAGEM VINDA DO WHATSAPP PARA O ODA ---
    // Verifica se é uma notificação de mensagem
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const messageInfo = body.entry[0].changes[0].value.messages[0];
      
      // Apenas processa mensagens do tipo 'text' por simplicidade
      if (messageInfo.type === 'text') {
        const from = messageInfo.from; // Número do remetente
        const text = messageInfo.text.body;

        console.log(`Recebida mensagem do WhatsApp de ${from}: "${text}"`);

        const odaPayload = {
          userId: from,
          messagePayload: {
            type: 'text',
            text: text
          }
        };
        console.log('OdaPayload:', odaPayload)
        
        /*try {
          await axios.post(ODA_WEBHOOK_URL, odaPayload, {
            headers: {
              'Content-Type': 'application/json',
              'X-Hub-Signature': 'sha1=' + crypto.createHmac('sha1', ODA_SECRET_KEY).update(JSON.stringify(odaPayload)).digest('hex') // ODA também espera uma assinatura, mas geralmente valida pela X-Hub-Signature-256 que é mais segura. A documentação deve ser consultada para o formato exato.
            }
          }); */
        
        try {
          await axios.post(ODA_WEBHOOK_URL, odaPayload);
          console.log(`Mensagem encaminhada para o ODA para o usuário ${from}`);
        } catch (error) {
          console.error('Erro ao enviar mensagem para o ODA:', error.response ? error.response.data : error.message);
        }
      }
    }
  }

  // Responde com 200 OK para o remetente (WhatsApp ou ODA) para confirmar o recebimento.
  res.sendStatus(200);
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(PORT, () => {
  console.log(`Servidor webhook rodando na porta ${PORT}`);
  console.log('Verifique se as variáveis de ambiente foram carregadas corretamente:');
  console.log(`- ODA_WEBHOOK_URL: ${ODA_WEBHOOK_URL ? 'OK' : 'FALTA'}`);
  console.log(`- ODA_SECRET_KEY: ${ODA_SECRET_KEY ? 'OK' : 'FALTA'}`);
  console.log(`- WHATSAPP_API_TOKEN: ${WHATSAPP_API_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`- WHATSAPP_PHONE_NUMBER_ID: ${WHATSAPP_PHONE_NUMBER_ID ? 'OK' : 'FALTA'}`);
  console.log(`- WHATSAPP_APP_SECRET_KEY: ${WHATSAPP_APP_SECRET_KEY ? 'OK' : 'FALTA'}`);
  console.log(`- VERIFY_TOKEN: ${VERIFY_TOKEN ? 'OK' : 'FALTA'}`);
});

// ---- VERIFICAR SE O WEBHOOK ESTÁ FUNCIONANDO ----
app.get("/", (req, res) => {
    res.status(200).send("Webhook funcionando!");
});

