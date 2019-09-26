
const isCommonjs = typeof module !== 'undefined' && module.exports;

class Socket {
    constructor(opt) {

        // copy opt into this:
        for (let k in opt) this[k] = opt[k];

        this.transport = opt.transport || "ws";
        this.hostname = opt.hostname || window.location.hostname; 
        this.port = opt.port || window.location.port; 
        this.protocols = opt.protocols || [];

        this.socket = null;

        let self = this;

        let connect = function() {
            const addr = self.transport+'://'+self.hostname+':'+self.port;
            if (isCommonjs) {
                let ws = require("ws");
                self.socket = new ws(addr, self.protocols);
            } else {
                self.socket = new WebSocket(addr, self.protocols);
            }
            self.socket.binaryType = 'arraybuffer';
            self.socket.onerror = self.onerror;
            self.socket.onopen = function() {
                console.log("websocket connected to "+addr);
                if (self.onopen) self.onopen();
            }
            if (isCommonjs) self.socket.on("open", self.socket.onopen);

            self.socket.onmessage = function(e) { 
                if (e.data instanceof ArrayBuffer) {
                    if (self.onbuffer) self.onbuffer(e.data, e.data.byteLength);
                    else console.log("ws received arraybuffer of " + e.data.byteLength + " bytes")
                } else {
                    let msg = e.data;
                    try {
                        msg = JSON.parse(msg);
                    } catch(e) {}
                    if (self.onmessage) self.onmessage(msg);
                    else console.log("ws received ", msg)
                } 
            }
            if (isCommonjs) self.socket.on("message", self.socket.onmessage);
            self.socket.onclose = function(e) {
                self.socket = null;
                setTimeout(function(){
                    if (self.reload_on_disconnect) {
                        window.location.reload(true);
                    } else {
                        console.log("websocket reconnecting");
                        setTimeout(connect, 1000);
                    }
                }, 2000);		
                if (self.onclose) self.onclose(e);
                else console.log("websocket disconnected from "+addr);
            }
            if (isCommonjs) self.socket.on("close", self.socket.onclose);
            if (isCommonjs) self.socket.on('error', self.onerror);
        }

        connect();
    }

    send(obj) {
        if (!this.socket) return;
        this.socket.send(JSON.stringify(obj));
    }
};


(function() {
    
    if (isCommonjs) {
		module.exports = Socket;
	} 
})();