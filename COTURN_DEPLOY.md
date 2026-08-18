# Deploying a TURN Server (Coturn)

By default, **mini stream** uses Google and Cloudflare's public STUN servers for NAT traversal. This is sufficient for the vast majority of peer-to-peer connections.

However, in restrictive corporate networks (symmetric NAT, strict firewalls), a direct P2P connection cannot be established. In these (~5-10%) cases, a TURN server is required to relay the media traffic.

**Coturn** is the industry standard open-source STUN/TURN server.

## Installation (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install coturn
```

## Configuration

Edit `/etc/turnserver.conf`:

```ini
# Listening port
listening-port=3478
tls-listening-port=5349

# Use a secure long-term credential mechanism
use-auth-secret
static-auth-secret=YOUR_SECURE_SECRET_HERE

# Your server's public IP and domain
external-ip=YOUR.PUBLIC.IP.ADDRESS
realm=turn.yourdomain.com

# SSL Certificates (Required for WebRTC in many browsers)
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem

# Security tuning
no-multicast-peers
no-cli
no-loopback-peers
no-tcp-relay
```

## Start the Service

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
```

## Using Coturn with mini stream

Once deployed, update the `iceServers` array in `src/js/webrtc-engine.js` to include your new TURN server:

```javascript
this.iceServers = [
  { urls: 'stun:turn.yourdomain.com:3478' },
  { 
    urls: 'turn:turn.yourdomain.com:3478',
    username: 'generated_username',
    credential: 'generated_password'
  }
];
```
*(Note: In a production environment, you should use an API endpoint to generate time-limited TURN credentials based on the `static-auth-secret` rather than hardcoding them).*
