// =============================================================================
// NetClient.js — tiny WebSocket client for the multiplayer race.
//
// Provides the conveniences raw WebSocket lacks:
//   - request(type, data) → Promise   (request/ack via reqId)
//   - send(type, data)                (fire-and-forget)
//   - on(type, handler)               (server-pushed events)
//   - onStatus(status)                ('open' | 'close' | 'error')
//   - auto-reconnect with outgoing queue
//
// Wire format matches the server: every frame is JSON { type, ...fields }.
// =============================================================================

class NetClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.handlers = {};   // type → fn(msg)
        this.pending = {};    // reqId → resolve
        this.reqSeq = 0;
        this.connected = false;
        this.queue = [];      // frames buffered until the socket opens
        this.onStatus = null; // (status) => void
        this._closedByUs = false;
    }

    connect() {
        if (this.ws && (this.connected || this.ws.readyState === WebSocket.CONNECTING)) return;
        this._closedByUs = false;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.connected = true;
            for (const frame of this.queue) this.ws.send(frame);
            this.queue = [];
            if (this.onStatus) this.onStatus('open');
        };
        this.ws.onclose = () => {
            this.connected = false;
            if (this.onStatus) this.onStatus('close');
            // Auto-reconnect unless we closed intentionally.
            if (!this._closedByUs) setTimeout(() => this.connect(), 1500);
        };
        this.ws.onerror = () => { if (this.onStatus) this.onStatus('error'); };
        this.ws.onmessage = (e) => this._recv(e.data);
    }

    _recv(data) {
        let msg;
        try { msg = JSON.parse(data); } catch (_) { return; }
        if (msg.type === 'ack') {
            const resolve = this.pending[msg.reqId];
            if (resolve) { delete this.pending[msg.reqId]; resolve(msg.payload); }
            return;
        }
        const fn = this.handlers[msg.type];
        if (fn) fn(msg);
    }

    on(type, fn) { this.handlers[type] = fn; }

    _raw(obj) {
        const frame = JSON.stringify(obj);
        if (this.connected) this.ws.send(frame);
        else this.queue.push(frame);
    }

    send(type, data = {}) { this._raw({ type, ...data }); }

    // Returns a Promise resolving with the server's ack payload.
    request(type, data = {}) {
        return new Promise((resolve) => {
            const reqId = ++this.reqSeq;
            this.pending[reqId] = resolve;
            this._raw({ type, reqId, ...data });
        });
    }

    close() {
        this._closedByUs = true;
        if (this.ws) this.ws.close();
    }
}
