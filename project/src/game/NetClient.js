export class NetClient {
  constructor({ onMessage = () => {}, onStatus = () => {} } = {}) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.url = '';
    this.opened = false;
  }

  authorityUrl() {
    const configured = window.__STUMBLE_AUTHORITY_URL__ || '';
    if (configured) {
      const base = configured.replace(/\/$/, '');
      return `${base.replace(/^http/, 'ws')}/ws`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  connect({ name, mode = 'original' } = {}) {
    this.close();
    this.url = this.authorityUrl();
    this.onStatus('SEARCHING FOR A ROOM…');
    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      this.onStatus(`CONNECTION FAILED · ${error.message}`);
      return;
    }
    this.socket.addEventListener('open', () => {
      this.opened = true;
      this.socket.send(JSON.stringify({ type: 'queue', name, mode }));
      this.onStatus('CONNECTED · LOOKING FOR RACERS…');
    });
    this.socket.addEventListener('message', (event) => {
      try {
        this.onMessage(JSON.parse(event.data));
      } catch {
        this.onStatus('AUTHORITY SENT AN INVALID MESSAGE');
      }
    });
    this.socket.addEventListener('close', () => {
      this.opened = false;
      this.onStatus('DISCONNECTED FROM AUTHORITY');
    });
    this.socket.addEventListener('error', () => this.onStatus('AUTHORITY CONNECTION ERROR'));
  }

  sendInput(frame) {
    if (!this.opened || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'input', ...frame }));
  }

  close() {
    this.opened = false;
    if (this.socket) this.socket.close();
    this.socket = null;
  }
}
