/**
 * This is almost a copy of the official Nore-red MQTT node found on node-red repository.
 * It's been fitted to our needs of simplicity for everyday use and repackaged
 */

module.exports = function (RED) {
	let mqtt = require('mqtt');
	let HttpsProxyAgent = require('https-proxy-agent');
	let url = require('url');

	function matchTopic(ts, t) {
		if (ts == '#') {
			return true;
		} else if (ts.startsWith('$share')) {
			ts = ts.replace(/^\$share\/[^#+/]+\/(.*)/g, '$1');
		}
		let re = new RegExp('^' + ts.replace(/([\[\]\?\(\)\\\\$\^\*\.|])/g, '\\$1').replace(/\+/g, '[^/]+').replace(/\/#$/, '(\/.*)?') + '$');
		return re.test(t);
	}

	function AliceMqtt(n) {
		RED.nodes.createNode(this, n);

		// Configuration options passed by Node Red
		this.broker = n.broker;
		this.port = n.port;
		this.usetls = n.usetls;
		this.usews = n.usews;
		this.verifyservercert = n.verifyservercert;

		// Config node state
		this.brokerurl = '';
		this.connected = false;
		this.connecting = false;
		this.closing = false;
		this.options = {};
		this.queue = [];
		this.subscriptions = {};

		if (this.credentials) {
			this.username = this.credentials.user;
			this.password = this.credentials.password;
		}

		// If the config node is missing certain options (it was probably deployed prior to an update to the node code),
		// select/generate sensible options for the new fields
		if (typeof this.usetls === 'undefined') {
			this.usetls = false;
		}
		if (typeof this.usews === 'undefined') {
			this.usews = false;
		}
		if (typeof this.verifyservercert === 'undefined') {
			this.verifyservercert = false;
		}

		let prox, noprox;
		if (process.env.http_proxy) {
			prox = process.env.http_proxy;
		}
		if (process.env.HTTP_PROXY) {
			prox = process.env.HTTP_PROXY;
		}
		if (process.env.no_proxy) {
			noprox = process.env.no_proxy.split(',');
		}
		if (process.env.NO_PROXY) {
			noprox = process.env.NO_PROXY.split(',');
		}


		// Create the URL to pass in to the MQTT.js library
		if (this.brokerurl === '') {
			// if the broker may be ws:// or wss:// or even tcp://
			if (this.broker.indexOf('://') > -1) {
				this.brokerurl = this.broker;
				// Only for ws or wss, check if proxy env var for additional configuration
				if (this.brokerurl.indexOf('wss://') > -1 || this.brokerurl.indexOf('ws://') > -1) {
					// check if proxy is set in env
					let noproxy;
					if (noprox) {
						for (let i = 0; i < noprox.length; i += 1) {
							if (this.brokerurl.indexOf(noprox[i].trim()) !== -1) {
								noproxy = true;
							}
						}
					}
					if (prox && !noproxy) {
						let parsedUrl = url.parse(this.brokerurl);
						let proxyOpts = url.parse(prox);
						// true for wss
						proxyOpts.secureEndpoint = parsedUrl.protocol ? parsedUrl.protocol === 'wss:' : true;
						// Set Agent for wsOption in MQTT
						let agent = new HttpsProxyAgent(proxyOpts);
						this.options.wsOptions = {
							agent: agent
						};
					}
				}
			} else {
				// construct the std mqtt:// url
				if (this.usetls) {
					this.brokerurl = '"mqtts://";';
				} else {
					this.brokerurl = 'mqtt://';
				}
				if (this.broker !== '') {
					//Check for an IPv6 address
					if (/(?:^|(?<=\s))(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))(?=\s|$)/.test(this.broker)) {
						this.brokerurl = `${this.brokerurl}[${this.broker}]:`;
					} else {
						this.brokerurl = `${this.brokerurl}${this.broker}:`;
					}
					// port now defaults to 1883 if unset.
					if (!this.port) {
						this.brokerurl += '1883'
					} else {
						this.brokerurl += this.port;
					}
				} else {
					this.brokerurl += 'localhost:1883';
				}
			}
		}

		// Build options for passing to the MQTT.js API
		this.options.clientId = 'ProjectAliceInterface';
		this.options.username = this.username;
		this.options.password = this.password;
		this.options.keepalive = 60;
		this.options.clean = true;
		this.options.reconnectPeriod = 5000;

		if (this.usetls && n.tls) {
			let tlsNode = RED.nodes.getNode(n.tls);
			if (tlsNode) {
				tlsNode.addTLSOptions(this.options);
			}
		}

		// If there's no rejectUnauthorized already, then this could be an
		// old config where this option was provided on the broker node and
		// not the tls node
		if (typeof this.options.rejectUnauthorized === 'undefined') {
			this.options.rejectUnauthorized = (this.verifyservercert == 'true' || this.verifyservercert === true);
		}

		// Define functions called by MQTT in and out nodes
		let node = this;
		this.users = {};

		this.register = function (mqttNode) {
			node.users[mqttNode.id] = mqttNode;
			node.connect();
		};

		this.deregister = function (mqttNode, done) {
			delete node.users[mqttNode.id];
			if (node.closing) {
				return done();
			}
			done();
		};

		this.connect = function () {
			if (!node.connected && !node.connecting) {
				node.connecting = true;
				try {
					node.client = mqtt.connect(node.brokerurl, node.options);
					node.client.setMaxListeners(0);
					// Register successful connect or reconnect handler
					node.client.on('connect', function () {
						node.connecting = false;
						node.connected = true;
						for (let id in node.users) {
							if (node.users.hasOwnProperty(id)) {
								node.users[id].status({
									fill : 'green',
									shape: 'dot',
									text : 'node-red:common.status.connected'
								});
							}
						}
						// Remove any existing listeners before resubscribing to avoid duplicates in the event of a re-connection
						node.client.removeAllListeners('message');

						// Re-subscribe to stored topics
						for (let s in node.subscriptions) {
							if (node.subscriptions.hasOwnProperty(s)) {
								let topic = s;
								let qos = 0;
								for (let r in node.subscriptions[s]) {
									if (node.subscriptions[s].hasOwnProperty(r)) {
										qos = Math.max(qos, node.subscriptions[s][r].qos);
										node.client.on('message', node.subscriptions[s][r].handler);
									}
								}
								let options = {qos: qos};
								node.client.subscribe(topic, options);
							}
						}
					});
					node.client.on('reconnect', function () {
						for (let id in node.users) {
							if (node.users.hasOwnProperty(id)) {
								node.users[id].status({
									fill : 'yellow',
									shape: 'ring',
									text : 'node-red:common.status.connecting'
								});
							}
						}
					});
					// Register disconnect handlers
					node.client.on('close', function () {
						if (node.connected) {
							node.connected = false;
							for (let id in node.users) {
								if (node.users.hasOwnProperty(id)) {
									node.users[id].status({
										fill : 'red',
										shape: 'ring',
										text : 'node-red:common.status.disconnected'
									});
								}
							}
						}
					});

					// Register connect error handler
					// The client's own reconnect logic will take care of errors
					node.client.on('error', function (error) {
					});
				} catch (err) {
					console.log(err);
				}
			}
		};

		this.subscribe = function (topic, qos, callback, ref) {
			ref = ref || 0;
			node.subscriptions[topic] = node.subscriptions[topic] || {};
			let sub = {
				topic  : topic,
				qos    : qos,
				handler: function (mtopic, mpayload, mpacket) {
					if (matchTopic(topic, mtopic)) {
						callback(mtopic, mpayload, mpacket);
					}
				},
				ref    : ref
			};
			node.subscriptions[topic][ref] = sub;
			if (node.connected) {
				node.client.on('message', sub.handler);
				let options = {};
				options.qos = qos;
				node.client.subscribe(topic, options);
			}
		};

		this.unsubscribe = function (topic, ref, removed) {
			ref = ref || 0;
			let sub = node.subscriptions[topic];
			if (sub) {
				if (sub[ref]) {
					node.client.removeListener('message', sub[ref].handler);
					delete sub[ref];
				}
				if (removed) {
					if (Object.keys(sub).length === 0) {
						delete node.subscriptions[topic];
						if (node.connected) {
							node.client.unsubscribe(topic);
						}
					}
				}
			}
		};

		this.publish = function (msg, done) {
			if (node.connected) {
				if (msg.payload === null || msg.payload === undefined) {
					msg.payload = '';
				} else if (!Buffer.isBuffer(msg.payload)) {
					if (typeof msg.payload === 'object') {
						msg.payload = JSON.stringify(msg.payload);
					} else if (typeof msg.payload !== 'string') {
						msg.payload = '' + msg.payload;
					}
				}

				let options = {
					qos   : msg.qos || 0,
					retain: msg.retain || false
				};
				node.client.publish(msg.topic, msg.payload, options, function (err) {
					done && done();
				});
			}
		};

		this.on('close', function (done) {
			this.closing = true;
			if (this.connected) {
				this.client.once('close', function () {
					done();
				});
				this.client.end();
			} else if (this.connecting || node.client.reconnecting) {
				node.client.end();
				done();
			} else {
				done();
			}
		});

	}

	RED.nodes.registerType('aliceMqtt', AliceMqtt, {
		credentials: {
			user    : {
				type: 'text'
			},
			password: {
				type: 'password'
			}
		}
	});
};
