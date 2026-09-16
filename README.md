# Video Vault Pro

Quiero que analices esto.. y prestes atencion a lo que quiero crear.. y me das ideas y metodos y opciones ya que mas de 1000 personas pueden entrar muy rapido.   este bot : import os
import logging
import psycopg
import threading
import time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
import requests
import paypalrestsdk
import json

# Configuración
BOT_TOKEN = os.environ.get('BOT_TOKEN')
VIP_GROUP_ID = int(os.environ.get('VIP_GROUP_ID', '-1001234567890'))  # NUEVO ID DEL GRUPO
PAYPAL_CLIENT_ID = os.environ.get('PAYPAL_CLIENT_ID')
PAYPAL_SECRET = os.environ.get('PAYPAL_SECRET')
DATABASE_URL = os.environ.get('DATABASE_URL')
RENDER_URL = os.environ.get('RENDER_URL', 'https://vip-telegram-bot-e0fc.onrender.com')

# Configurar PayPal
paypalrestsdk.configure({
    "mode": "live",
    "client_id": PAYPAL_CLIENT_ID,
    "client_secret": PAYPAL_SECRET
})

# Inicializar Flask
app = Flask(__name__)

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============ SELF-PING INTERNO ============
def self_ping():
    """Hace ping al propio servidor cada 4 minutos para mantenerse despierto"""
    time.sleep(30)  # Espera 30 segundos al inicio para que el servidor arranque
    while True:
        try:
            response = requests.get(f"{RENDER_URL}/health", timeout=10)
            logger.info(f"Self-ping OK: {response.status_code}")
        except Exception as e:
            logger.error(f"Self-ping error: {e}")
        time.sleep(240)  # 4 minutos

# Iniciar self-ping en hilo separado
ping_thread = threading.Thread(target=self_ping, daemon=True)
ping_thread.start()

# Base de datos PostgreSQL
def get_db_connection():
    conn = psycopg.connect(DATABASE_URL)
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            username TEXT,
            payment_id TEXT,
            subscription_start TEXT,
            subscription_end TEXT,
            status TEXT DEFAULT 'inactive',
            payment_method TEXT,
            invite_link TEXT,
            used_free_trial BOOLEAN DEFAULT FALSE
        )
    ''')
    try:
        c.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS used_free_trial BOOLEAN DEFAULT FALSE')
    except Exception:
        pass
    conn.commit()
    conn.close()

# Planes de precios
PLANS = {
    'monthly': {'days': 30, 'price': '5.00', 'name': 'Mensual', 'display': '1 Mes - $5'},
    'quarterly': {'days': 90, 'price': '10.00', 'name': 'Trimestral', 'display': '3 Meses - $10'},
    'lifetime': {'days': 36500, 'price': '100.00', 'name': 'De por vida', 'display': '♾️ De por vida - $100'}
}

def send_message(chat_id, text, reply_markup=None):
    """Envía mensaje a Telegram"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'Markdown'
    }
    if reply_markup:
        payload['reply_markup'] = json.dumps(reply_markup)
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        return response.json()
    except Exception as e:
        logger.error(f"Error enviando mensaje: {e}")
        return None

def answer_callback_query(callback_query_id):
    """Responde a callback query"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/answerCallbackQuery"
    try:
        requests.post(url, json={'callback_query_id': callback_query_id}, timeout=5)
    except Exception as e:
        logger.error(f"Error respondiendo callback: {e}")

def edit_message_text(chat_id, message_id, text, reply_markup=None):
    """Edita mensaje existente"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText"
    payload = {
        'chat_id': chat_id,
        'message_id': message_id,
        'text': text,
        'parse_mode': 'Markdown',
        'disable_web_page_preview': True
    }
    if reply_markup:
        payload['reply_markup'] = json.dumps(reply_markup)
    
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        logger.error(f"Error editando mensaje: {e}")

# ============ RUTAS WEBHOOK ============

@app.route('/webhook/' + BOT_TOKEN, methods=['POST'])
def telegram_webhook():
    """Recibe actualizaciones de Telegram"""
    data = request.get_json()
    logger.info(f"Webhook recibido: {data}")
    
    if 'message' in data:
        message = data['message']
        chat_id = message['chat']['id']
        text = message.get('text', '')
        
        if text == '/start':
            handle_start(chat_id)
            
    elif 'callback_query' in data:
        callback = data['callback_query']
        callback_id = callback['id']
        chat_id = callback['message']['chat']['id']
        message_id = callback['message']['message_id']
        data_value = callback['data']
        
        answer_callback_query(callback_id)
        
        if data_value == 'free_trial':
            handle_free_trial(chat_id, message_id)
        elif data_value.startswith('plan_'):
            handle_plan_selection(chat_id, message_id, data_value.replace('plan_', ''))
    
    return jsonify({'ok': True})

# Ruta alternativa sin token
@app.route('/webhook', methods=['POST'])
def webhook_alt():
    return telegram_webhook()

def check_free_trial_used(chat_id):
    """Verifica si el usuario ya usó el acceso gratis"""
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute('SELECT used_free_trial FROM users WHERE user_id = %s', (chat_id,))
        row = c.fetchone()
        conn.close()
        if row is None:
            return False
        return row[0]
    except Exception as e:
        logger.error(f"Error verificando free trial: {e}")
        return True

def handle_start(chat_id):
    """Maneja comando /start"""
    free_trial_used = check_free_trial_used(chat_id)

    if not free_trial_used:
        keyboard = {
            'inline_keyboard': [
                [{'text': '🎁 1 Día GRATIS (solo 1 vez)', 'callback_data': 'free_trial'}],
                [{'text': PLANS['monthly']['display'], 'callback_data': 'plan_monthly'}],
                [{'text': PLANS['quarterly']['display'], 'callback_data': 'plan_quarterly'}],
                [{'text': PLANS['lifetime']['display'], 'callback_data': 'plan_lifetime'}]
            ]
        }
        text = ("🌟 *Bienvenido al VIP*\n\n"
                "🎁 ¡Tienes disponible *1 día de acceso GRATIS*!\n"
                "Solo disponible una vez por usuario.\n\n"
                "Selecciona tu plan de suscripción:\n"
                "⏱️ El acceso es automático tras el pago\n"
                "🔒 Sin renovación automática - tú decides si renovar\n\n"
                "💳 Pagos seguros vía PayPal")
    else:
        keyboard = {
            'inline_keyboard': [
                [{'text': PLANS['monthly']['display'], 'callback_data': 'plan_monthly'}],
                [{'text': PLANS['quarterly']['display'], 'callback_data': 'plan_quarterly'}],
                [{'text': PLANS['lifetime']['display'], 'callback_data': 'plan_lifetime'}]
            ]
        }
        text = ("🌟 *Bienvenido al VIP*\n\n"
                "Selecciona tu plan de suscripción:\n"
                "⏱️ El acceso es automático tras el pago\n"
                "🔒 Sin renovación automática - tú decides si renovar\n\n"
                "💳 Pagos seguros vía PayPal")

    send_message(chat_id, text, keyboard)

def handle_free_trial(chat_id, message_id):
    """Maneja el acceso gratis de 1 día"""
    if check_free_trial_used(chat_id):
        edit_message_text(chat_id, message_id,
            "❌ Ya usaste tu acceso gratis anteriormente.\n\n"
            "Usa /start para ver los planes de pago.")
        return

    invite_link = generate_invite_link()

    if invite_link:
        start_date = datetime.now()
        end_date = start_date + timedelta(days=1)

        try:
            conn = get_db_connection()
            c = conn.cursor()
            c.execute('''
                INSERT INTO users (user_id, subscription_start, subscription_end, status, payment_method, used_free_trial)
                VALUES (%s, %s, %s, 'active', 'free_trial', TRUE)
                ON CONFLICT (user_id) DO UPDATE SET
                    subscription_start = %s,
                    subscription_end = %s,
                    status = 'active',
                    payment_method = 'free_trial',
                    used_free_trial = TRUE
            ''', (chat_id, start_date.isoformat(), end_date.isoformat(),
                  start_date.isoformat(), end_date.isoformat()))
            conn.commit()
            conn.close()
            logger.info(f"Usuario {chat_id} activado con free trial")
        except Exception as e:
            logger.error(f"Error guardando free trial: {e}")

        keyboard = {
            'inline_keyboard': [[{'text': '🔗 Unirse al VIP', 'url': invite_link}]]
        }

        text = ("🎁 *¡Acceso gratis activado!*\n\n"
                "✅ Plan: 1 Día Gratis\n"
                "⏰ Válido hasta: " + end_date.strftime('%d/%m/%Y %H:%M') + "\n\n"
                "🔗 *Tu link de acceso VIP:*\n" + invite_link + "\n\n"
                "⚠️ *Importante:*\n"
                "• El link es de un solo uso\n"
                "• Válido por 24 horas\n"
                "• Únete al grupo inmediatamente\n\n"
                "🔔 Este es tu único acceso gratis. Para continuar deberás suscribirte.")

        edit_message_text(chat_id, message_id, text, keyboard)
    else:
        edit_message_text(chat_id, message_id,
            "❌ Error generando el link. Contacta al administrador.")

def handle_plan_selection(chat_id, message_id, plan_key):
    """Maneja selección de plan"""
    plan = PLANS.get(plan_key)
    if not plan:
        return

    payment = paypalrestsdk.Payment({
        "intent": "sale",
        "payer": {"payment_method": "paypal"},
        "redirect_urls": {
            "return_url": f"https://vip-telegram-bot-e0fc.onrender.com/success?user_id={chat_id}&plan={plan_key}",
            "cancel_url": f"https://vip-telegram-bot-e0fc.onrender.com/cancel?user_id={chat_id}"
        },
        "transactions": [{
            "amount": {"total": plan['price'], "currency": "USD"},
            "description": f"Suscripción VIP {plan['name']} - {plan['days']} días"
        }]
    })

    if payment.create():
        try:
            conn = get_db_connection()
            c = conn.cursor()
            c.execute('''
                INSERT INTO users (user_id, payment_id, status, payment_method)
                VALUES (%s, %s, 'pending', 'paypal')
                ON CONFLICT (user_id) DO UPDATE SET payment_id = %s, status = 'pending'
            ''', (chat_id, payment.id, payment.id))
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error guardando en DB: {e}")

        approval_url = None
        for link in payment.links:
            if link.rel == "approval_url":
                approval_url = link.href
                break

        if approval_url:
            if plan_key == 'lifetime':
                duracion = 'De por vida ♾️'
            else:
                duracion = str(plan['days']) + ' días'

            text = ("💳 *Plan " + plan['name'] + "*\n"
                    "📅 Duración: " + duracion + "\n"
                    "💰 Precio: $" + plan['price'] + "\n\n"
                    "[👉 Click aquí para pagar con PayPal](" + approval_url + ")\n\n"
                    "⚡ Una vez completado el pago, recibirás el link de invitación automáticamente.\n"
                    "⏳ El link de pago expira en 30 minutos.")

            edit_message_text(chat_id, message_id, text)

@app.route('/success', methods=['GET'])
def payment_success():
    """Pago exitoso de PayPal"""
    user_id = request.args.get('user_id')
    plan_key = request.args.get('plan')
    payment_id = request.args.get('paymentId')
    payer_id = request.args.get('PayerID')

    logger.info(f"Success called: user_id={user_id}, plan={plan_key}, paymentId={payment_id}, PayerID={payer_id}")

    if not all([user_id, plan_key, payment_id, payer_id]):
        logger.error(f"Datos incompletos")
        return "❌ Datos incompletos. Contacta al administrador.", 400

    plan = PLANS.get(plan_key)
    if not plan:
        logger.error(f"Plan inválido: {plan_key}")
        return "❌ Plan inválido. Contacta al administrador.", 400

    try:
        payment = paypalrestsdk.Payment.find(payment_id)
    except Exception as e:
        logger.error(f"Error finding payment: {e}")
        return "❌ Error al verificar el pago.", 500

    if payment.execute({"payer_id": payer_id}):
        start_date = datetime.now()
        end_date = start_date + timedelta(days=plan['days'])

        invite_link = generate_invite_link()

        if invite_link:
            try:
                conn = get_db_connection()
                c = conn.cursor()
                c.execute('''
                    UPDATE users 
                    SET subscription_start = %s, subscription_end = %s, status = 'active', 
                        payment_method = 'paypal', invite_link = %s
                    WHERE user_id = %s
                ''', (start_date.isoformat(), end_date.isoformat(), invite_link, user_id))
                conn.commit()
                conn.close()
                logger.info(f"Usuario {user_id} actualizado con suscripción activa")
            except Exception as e:
                logger.error(f"Error guardando en DB: {e}")

            keyboard = {
                'inline_keyboard': [[{'text': '🔗 Unirse al VIP', 'url': invite_link}]]
            }

            if plan_key == 'lifetime':
                duracion = 'De por vida ♾️'
                validez = 'De por vida ♾️'
                nota = '🔔 Acceso permanente, nunca serás removido.'
            else:
                duracion = str(plan['days']) + ' días'
                validez = end_date.strftime('%d/%m/%Y')
                nota = '🔔 Te avisaremos 24h antes de que expire tu suscripción.'

            text = ("🎉 *¡Pago confirmado!*\n\n"
                    "✅ Plan: " + plan['name'] + "\n"
                    "📅 Duración: " + duracion + "\n"
                    "⏰ Válido hasta: " + validez + "\n\n"
                    "🔗 *Tu link de acceso VIP:*\n" + invite_link + "\n\n"
                    "⚠️ *Importante:*\n"
                    "• El link es de un solo uso\n"
                    "• Válido por 24 horas\n"
                    "• Únete al grupo inmediatamente\n\n"
                    + nota)

            send_message(user_id, text, keyboard)

            return "✅ ¡Pago exitoso! Revisa tu Telegram para el link de acceso."
        else:
            logger.error("No se pudo generar el link de invitación")
            return "✅ ¡Pago exitoso! Pero hubo un error generando el link. Contacta al administrador.", 500
    else:
        logger.error(f"Error ejecutando pago: {payment.error}")
        return "❌ Error al procesar el pago en PayPal.", 400

@app.route('/cancel', methods=['GET'])
def payment_cancel():
    """Pago cancelado"""
    return "❌ Pago cancelado. Puedes intentarlo de nuevo con /start en el bot."

def generate_invite_link():
    """Genera link de invitación de un solo uso válido por 24h (PARA GRUPOS)"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/createChatInviteLink"
    expire_date = int((datetime.now() + timedelta(hours=24)).timestamp())

    params = {
        'chat_id': VIP_GROUP_ID,
        'member_limit': 1,
        'expire_date': expire_date
    }

    try:
        response = requests.post(url, json=params, timeout=10)
        data = response.json()
        if data.get('ok'):
            return data['result']['invite_link']
        else:
            logger.error(f"Error en respuesta de Telegram: {data}")
    except Exception as e:
        logger.error(f"Error generando link: {e}")

    return None

@app.route('/cron', methods=['GET'])
def cron_endpoint():
    """Dispara la verificación de expiraciones en segundo plano y responde de inmediato"""
    threading.Thread(target=check_expired_subscriptions, daemon=True).start()
    return "✅ Verificación iniciada en segundo plano", 200

@app.route('/health', methods=['GET'])
def health_check():
    """Health check"""
    return "✅ Bot activo", 200

def check_expired_subscriptions():
    """Verifica y expira suscripciones vencidas (FUNCIONA CON GRUPOS)"""
    try:
        conn = get_db_connection()
        c = conn.cursor()

        now = datetime.now().isoformat()

        c.execute('''
            SELECT user_id FROM users 
            WHERE subscription_end < %s AND status = 'active'
        ''', (now,))

        expired = c.fetchall()

        for (user_id,) in expired:
            try:
                ban_url = f"https://api.telegram.org/bot{BOT_TOKEN}/banChatMember"
                requests.post(ban_url, json={
                    'chat_id': VIP_GROUP_ID,
                    'user_id': user_id,
                    'revoke_messages': False
                }, timeout=10)

                unban_url = f"https://api.telegram.org/bot{BOT_TOKEN}/unbanChatMember"
                requests.post(unban_url, json={
                    'chat_id': VIP_GROUP_ID,
                    'user_id': user_id
                }, timeout=10)

                c.execute('UPDATE users SET status = %s WHERE user_id = %s',
                         ('expired', user_id))
                conn.commit()

                send_message(user_id,
                    "⏰ *Tu suscripción VIP ha expirado*\n\n"
                    "Has sido removido del grupo VIP.\n"
                    "Para volver a unirte, usa /start y realiza un nuevo pago.\n\n"
                    "¡Gracias por tu preferencia! 🌟"
                )

                logger.info(f"Usuario {user_id} expirado y removido")

            except Exception as e:
                logger.error(f"Error expirando usuario {user_id}: {e}")

        conn.close()
    except Exception as e:
        logger.error(f"Error en check_expired_subscriptions: {e}")

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)
lo vamos usar para crear un bot en @connector:telegram:"Telegram" para una biblioteca de mas de 1700 videos git de ejercicios. los cuales quiero vender con ese bot por pago de paypal que al confirmas le de 2 opciones ver en linea por solo 2 dolare o ver y descargar por 10 dolares.  la seguridad es muy importante y que no pueda usar los videos para compartir uh otra cosa si solo pago el plan de 2 dolares. ahi te subi los gif  1 para que entiendas. ahora dame ideas propuestas y todo para ver como lo hacemos paso por paso.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/92e151d4-4977-4f6c-815e-f82fbf452249).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
