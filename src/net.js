/**
 * Online 2P over WebRTC (PeerJS). The host runs the full simulation and
 * streams snapshots; the guest sends inputs and renders the host's state.
 * PeerJS' public signalling server is used only to exchange connection
 * offers — gameplay traffic is peer-to-peer.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode() {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}
const peerId = (code) => `sunstone-league-${code.toUpperCase()}`;

/**
 * Signalling options. By default PeerJS' public cloud brokers the connection;
 * gameplay itself is always peer-to-peer. A self-hosted broker can be supplied
 * as `?peer=host[:port][/path]` (remembered afterwards), which is also how the
 * online mode is tested without reaching the public server.
 */
export function peerOptions() {
  let setting = null;
  try {
    const fromUrl = new URLSearchParams(location.search).get('peer');
    if (fromUrl !== null) {
      setting = fromUrl.trim();
      if (setting) localStorage.setItem('ssl-peer', setting); else localStorage.removeItem('ssl-peer');
    } else setting = localStorage.getItem('ssl-peer');
  } catch { /* storage unavailable */ }
  if (!setting) return { debug: 0 };
  const [hostPart, ...pathParts] = setting.replace(/^wss?:\/\//, '').split('/');
  const [host, port] = hostPart.split(':');
  const options = { debug: 0, host, secure: location.protocol === 'https:' };
  if (port) options.port = Number(port);
  if (pathParts.length) options.path = '/' + pathParts.join('/');
  return options;
}

async function loadPeer() {
  const module = await import('peerjs');
  return module.Peer || module.default;
}

export class NetSession {
  constructor() {
    this.peer = null; this.conn = null; this.role = null; this.code = null;
    this.onMessage = () => {}; this.onClose = () => {}; this.onOpen = () => {};
    this.latency = 0; this.lastPing = 0;
  }

  async host() {
    // Assigned before the first await so callers can show the room code as
    // soon as host() is called, rather than racing the peerjs import.
    this.role = 'host';
    this.code = makeRoomCode();
    const Peer = await loadPeer();
    this.peer = new Peer(peerId(this.code), peerOptions());
    await new Promise((resolve, reject) => {
      this.peer.on('open', resolve);
      this.peer.on('error', (error) => reject(error));
    });
    return new Promise((resolve) => {
      this.peer.on('connection', (conn) => {
        if (this.conn) { conn.close(); return; }
        this.attach(conn);
        conn.on('open', () => { this.onOpen(); resolve(conn); });
      });
    });
  }

  async join(code) {
    const Peer = await loadPeer();
    this.role = 'guest';
    this.code = code.toUpperCase();
    this.peer = new Peer(peerOptions());
    await new Promise((resolve, reject) => { this.peer.on('open', resolve); this.peer.on('error', reject); });
    const conn = this.peer.connect(peerId(this.code), { reliable: false, serialization: 'json' });
    this.attach(conn);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No host answered. Check the code and try again.')), 15000);
      conn.on('open', () => { clearTimeout(timer); this.onOpen(); resolve(); });
      this.peer.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
  }

  attach(conn) {
    this.conn = conn;
    conn.on('data', (data) => {
      if (data?.t === 'ping') { this.send({ t: 'pong', at: data.at }); return; }
      if (data?.t === 'pong') { this.latency = performance.now() - data.at; return; }
      this.onMessage(data);
    });
    conn.on('close', () => { this.conn = null; this.onClose(); });
    conn.on('error', () => { this.conn = null; this.onClose(); });
  }

  send(message) {
    if (this.conn?.open) { try { this.conn.send(message); } catch { /* dropped */ } }
  }

  ping() {
    const now = performance.now();
    if (now - this.lastPing > 2000) { this.lastPing = now; this.send({ t: 'ping', at: now }); }
  }

  close() {
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
