const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Buffer } = require('buffer');
const Tesseract = require('tesseract.js');

exports.handleComprovanteFoto = async (sock, msg) => {
  try {
    const from = msg.key.remoteJid;

    // Só continua se for imagem
    if (!msg.message?.imageMessage) return;

    const legenda = msg.message.imageMessage.caption || '';
    const cleanLegenda = legenda.replace(/[\u200e\u200f\u2068\u2069]/g, '').trim();

    function extrairNumeroLocal(text) {
      const textoSemEspacos = text.replace(/[\s\-\.]/g, '');
      const match = textoSemEspacos.match(/(?:\+?258)?(8\d{8})/);
      return match ? match[1] : null;
    }

    const numeroCompleto = extrairNumeroLocal(cleanLegenda);
    const prefixo = numeroCompleto ? numeroCompleto.substring(0, 2) : null;

    if (numeroCompleto && prefixo !== "84" && prefixo !== "85") {
      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      });

      await sock.sendMessage(from, {
        text: `🤖 Número *${numeroCompleto}* inválido.\n\n🚫 Apenas números da *Vodacom (84/85)* são aceitos no comprovante.`,
      });

      console.log(`🚫 Número inválido detectado no comprovante: ${numeroCompleto}`);
      return;
    }

    const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const { data: { text } } = await Tesseract.recognize(buffer, 'por', {
      logger: m => console.log(m)
    });

    const normalizedText = text.replace(/-\s*\n\s*/g, '').replace(/[\u200e\u200f\u2068\u2069]/g, '').trim();

    console.log('Texto extraído via OCR (normalizado):', normalizedText);

    // Busca por elementos-chave
    const valorMatch = normalizedText.match(/Transferiste[\s\S]*?([\d.,]+)MT/i);
    const valorTransferido = valorMatch ? valorMatch[1].replace(',', '.') : null;

    const idMatch = normalizedText.match(/\b([A-Z]{2,3}[0-9A-Z.\-]{6,15})\b/);
    const idTransacao = idMatch ? idMatch[1] : null;

    const trechoNumeroTransferidoMatch = normalizedText.match(/(?:transferido para|para o número)\s*([\d\s\+\-\.]+)/i);
    let numeroTransferido = trechoNumeroTransferidoMatch
      ? extrairNumeroLocal(trechoNumeroTransferidoMatch[1])
      : null;

    if (!numeroTransferido) {
      const match = normalizedText.match(/8\d{8}/);
      numeroTransferido = match ? match[0] : null;
    }

    const numerosValidos = ['872960710', '848619531'];
    const operadorasEncontradas = /(mpesa|m-pesa|emola|e-mola|bim)/i.test(normalizedText);

    // Lógica de verificação: pelo menos 3 dos 4 elementos devem estar presentes
    const elementosDetectados = [
      valorTransferido ? 1 : 0,
      idTransacao ? 1 : 0,
      numeroTransferido && numerosValidos.includes(numeroTransferido) ? 1 : 0,
      operadorasEncontradas ? 1 : 0
    ];
    const totalValido = elementosDetectados.reduce((a, b) => a + b, 0);

    if (totalValido < 2) {
      console.log('🚫 Imagem ignorada – não parece ser um comprovativo.');
      return;
    }

    // Rejeita caso o número de destino seja inválido
    if (!numerosValidos.includes(numeroTransferido)) {
      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      });

      await new Promise(resolve => setTimeout(resolve, 20000));

      await sock.sendMessage(from, {
        text: `🚫 *Comprovante rejeitado!*\n\nO número para qual foi transferido o valor é *inválido*.\n\n📱 *Números aceitos para transferência:*\n\n1. 📲 *872960710* - *Manuel Zoca*\n2. 📲 *848619531* - *Dinis Marta*\n\n🔒 *Aviso:* Qualquer tentativa de envio de comprovativos falsos pode resultar em *banimento imediato!*`,
        contextInfo: {
          quotedMessage: { imageMessage: msg.message.imageMessage },
          participant: msg.key.participant || msg.key.remoteJid
        }
      });

      console.log(`🚫 Transferência para número inválido detectada: ${numeroTransferido}`);
      return;
    }

    await sock.sendMessage(from, {
      react: { text: "✅", key: msg.key }
    });

    await new Promise(resolve => setTimeout(resolve, 20000));

    let mensagem = `✅ Comprovante recebido`;

    if (numeroCompleto) {
      mensagem += `\n\npara o número: *${numeroCompleto}*.`;
    } else {
      mensagem += `.\n\nPor favor, envie o número para qual deseja receber os megas.`;
    }

    if (valorTransferido) mensagem += `\n💰 Valor transferido: *${valorTransferido} MT*`;
    if (idTransacao) mensagem += `\n🆔 ID da transação: *${idTransacao}*`;

    mensagem += `\n🔄 Enviaremos os megas em 1min... Por favor, aguarde a confirmação.`;

    await sock.sendMessage(from, {
      text: mensagem,
      contextInfo: {
        quotedMessage: { imageMessage: msg.message.imageMessage },
        participant: msg.key.participant || msg.key.remoteJid
      }
    });

    if (!numeroCompleto) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await sock.sendMessage(from, {
        text: '📲 Por favor, envie o número para qual deseja receber os megas.',
        contextInfo: {
          quotedMessage: { imageMessage: msg.message.imageMessage },
          participant: msg.key.participant || msg.key.remoteJid
        }
      });
    }

    console.log(`📷 Comprovante detectado para ${numeroCompleto || 'número não informado'} - Valor: ${valorTransferido || 'não detectado'} - ID: ${idTransacao || 'não detectado'}`);

  } catch (error) {
    console.error('❌ Erro em handleComprovanteFoto:', error);
  }
};
