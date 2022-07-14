module.exports = function (RED) {

	let axios = require('axios')

	let mqtt = require('mqtt')
	let HttpsProxyAgent = require('https-proxy-agent')
	let url = require('url')

	let NODE_PATH = '/AliceCore/'

	function matchTopic(ts, t) {
		if (ts === '#') {
			return true
		} else if (ts.startsWith('$share')) {
			ts = ts.replace(/^\$share\/[^#+/]+\/(.*)/g, '$1')
		}
		let re = new RegExp('^' + ts.replace(/([\[\]\?\(\)\\\\$\^\*\.|])/g, '\\$1').replace(/\+/g, '[^/]+').replace(/\/#$/, '(\/.*)?') + '$')
		return re.test(t)
	}


	RED.httpAdmin.get(NODE_PATH + 'getVoiceDevices', async (req, res) => {
		let config = req.query
		let controller = RED.nodes.getNode(config.controllerID)
		let forceRefresh = config.forceRefresh ? ['1', 'yes', 'true'].includes(config.forceRefresh.toLowerCase()) : false
		if (controller && controller.constructor.name === 'aliceConnection') {
			let internal = await controller.getVoiceDevices()
			res.json(internal)
		} else {
			RED.log.error('No AliceController found!' + config.controllerID)
			res.json([{}, {}])
		}
	})

	RED.httpAdmin.get(NODE_PATH + 'getSkills', async (req, res) => {
		let config = req.query
		let controller = RED.nodes.getNode(config.controllerID)
		let forceRefresh = config.forceRefresh ? ['1', 'yes', 'true'].includes(config.forceRefresh.toLowerCase()) : false
		if (controller && controller.constructor.name === 'aliceConnection') {
			let internal = await controller.getSkills()
			res.json(internal)
		} else {
			RED.log.error('No AliceController found!' + config.controllerID)
			res.json([{}, {}])
		}
	})

	RED.httpAdmin.get(NODE_PATH + 'getTalkTopics', async (req, res) => {
		let config = req.query
		let controller = RED.nodes.getNode(config.controllerID)
		let skill = config.skill
		let forceRefresh = config.forceRefresh ? ['1', 'yes', 'true'].includes(config.forceRefresh.toLowerCase()) : false
		if (controller && controller.constructor.name === 'aliceConnection') {
			let internal = await controller.getTalkTopics(skill)
			res.json(internal)
		} else {
			RED.log.error('No AliceController found!' + config.controllerID)
			res.json([{}, {}])
		}
	})

	RED.httpAdmin.get(NODE_PATH + 'status', async (req, res) => {
		let config = req.query
		let controller = RED.nodes.getNode(config.controllerID)
		let forceRefresh = config.forceRefresh ? ['1', 'yes', 'true'].includes(config.forceRefresh.toLowerCase()) : false
		if (controller && controller.constructor.name === 'aliceConnection') {
			res.json({
				'MQTT':      (controller.mqtt.connected),
				'authLevel': 'admin',
				'apiToken':  (controller.apiToken ? 'supplied' : '')
			})
		} else {
			RED.log.error('No AliceController found!' + config.controllerID)
			res.json([{}, {}])
		}
	})


	class aliceConnection {
		constructor(n) {
			RED.nodes.createNode(this, n)
			let node = this
			node.config = n

			this.users = {}

			// API


			// MQTT
			node.mqtt = new AliceMqtt(node)
			node.getApiToken().then(() => node.getMqttConfig())


			// on events
			node.on('close', () => this.onClose())
		}


		register(mqttNode) {
			this.users[mqttNode.id] = mqttNode
			if (this.mqtt) {
				this.mqtt.connect()
			}
		};


		deregister(mqttNode, done) {
			delete this.users[mqttNode.id]
			if (this.mqtt.closing) {
				return done()
			}
			done()
		};


		async getVoiceDevices() {
			let that = this
			let res = await axios({
				method:  'GET',
				url:     `http://${that.config.apiIp}:${that.config.apiPort}/api/v1.0.1/devices/allPlaySound/`,
				headers: {'auth': that.credentials.apiToken}
			})
				.catch(error => {
					that.log('ERROR: ' + error)
				})
			let ret = {}
			for (let index in res.data['devices']) {
				ret[res.data['devices'][index]['deviceConfigs']['displayName']] = res.data['devices'][index]['uid']
			}
			return ret
		}


		async getTalkTopics(skill) {
			let that = this
			let res = await axios({
				method:  'GET',
				url:     `http://${that.config.apiIp}:${that.config.apiPort}/api/v1.0.1/skills/${skill}/getTalkTopics/`,
				headers: {'auth': that.credentials.apiToken}
			})
				.catch(error => {
					that.log('ERROR: ' + error)
				})
			return res.data['talkTopics']
		}


		async getSkills() {
			let that = this
			let res = await axios({
				method:  'GET',
				url:     `http://${that.config.apiIp}:${that.config.apiPort}/api/v1.0.1/skills/`,
				headers: {'auth': that.credentials.apiToken}
			})
				.catch(error => {
					that.log('ERROR: ' + error)
				})
			let nrView = {}
			for (let index in res.data['skills']) {
				nrView[res.data['skills'][index]['name']] = {
					'intents': res.data['skills'][index]['intents'], 'talks': []
				}
			}
			return nrView
		}


		onClose() {
			let node = this
			node.mqtt.onClose()
			node.apiToken = ''
			node.connection = false
			node.emit('onClose')
			node.log('MQTT connection closed')
		}


		async login() {
			let that = this

			if (this.credentials.username === undefined || this.credentials.pin === undefined) {
				that.error(JSON.stringify(this))
				that.error('Alice api credentials missing.')
				return
			}

			let url = `http://${that.config.apiIp}:${that.config.apiPort}/api/v1.0.1/login/`
			that.log(`Requesting Token for ${that.credentials.username} - ${url}`)
			let data = new URLSearchParams()
			data.append('username', that.credentials.username)
			data.append('pin', that.credentials.pin)
			let response = await axios({
				method: 'POST', url: url, data: data, headers: {'Content-Type': 'application/x-www-form-urlencoded'}
			}).catch((err) => {
				that.error(err)
			})
			if ('apiToken' in response.data) {
				that.apiToken = response.data['apiToken']
				that.authLevel = response.data['authLevel']
				that.log('Logged in.')
				return response.data
			}
		}


		async getApiToken() {
			let response = await this.login()
			this.log('ApiToken collected')
			return response['apiToken']
		}


		getMqttConfig() {
			let that = this
			if (that.credentials.apiToken === undefined) {
				that.error('Alice api token missing.')
				return
			}
			let url = `http://${that.config.apiIp}:${that.config.apiPort}/api/v1.0.1/utils/config/`
			that.log(`Requesting MQTT config - ${url}`)
			axios({
				method: 'GET', url: url, headers: {'auth': that.credentials.apiToken}
			}).then(res => {
				that.mqttIp = res.data.config.mqttHost
				that.mqttPort = res.data.config.mqttPort
				that.credentials.mqttPassword = res.data.config.mqttPassword
				that.log(`statusCode: ${res.status} - MQTT settings collected`)
				//that.log(JSON.stringify(res.data))
				that.mqtt.update(that)
				that.mqtt.connect()
			})
			  .catch(error => {
				  that.log('ERROR: ' + error)
			  })
			that.refresh = false
		}

	}


	RED.nodes.registerType('aliceConnection', aliceConnection, {
		credentials: {
			username: {type: 'text'}, pin: {type: 'password'}
		}
	})


	class AliceMqtt {
		constructor(n) {
			this.node = n
			// Configuration options passed by Node Red
			this.broker = n.mqttIp
			this.port = n.mqttPort
			this.usetls = n.usetls
			this.usews = n.usews
			this.verifyservercert = n.verifyservercert

			if (this.node.credentials) {
				this.username = this.node.credentials.user
				this.password = this.node.credentials.password
			}

			// Config node state
			this.connected = false
			this.connecting = false
			this.closing = false
			this.options = {}
			this.queue = []
			this.subscriptions = {}

			// If the config node is missing certain options (it was probably deployed prior to an update to the node code),
			// select/generate sensible options for the new fields
			if (typeof this.usetls === 'undefined') {
				this.usetls = false
			}
			if (typeof this.usews === 'undefined') {
				this.usews = false
			}
			if (typeof this.verifyservercert === 'undefined') {
				this.verifyservercert = false
			}

			this.brokerurl = this.getBrokerUrl()

			// Build options for passing to the MQTT.js API
			this.options.clientId = 'ProjectAliceNR'
			this.options.username = this.username
			this.options.password = this.password
			this.options.keepalive = 60
			this.options.clean = true
			this.options.reconnectPeriod = 5000

			if (this.usetls && n.tls) {
				let tlsNode = RED.nodes.getNode(n.tls)
				if (tlsNode) {
					tlsNode.addTLSOptions(this.options)
				}
			}

			// If there's no rejectUnauthorized already, then this could be an
			// old config where this option was provided on the broker node and
			// not the tls node
			if (typeof this.options.rejectUnauthorized === 'undefined') {
				this.options.rejectUnauthorized = (this.verifyservercert === 'true' || this.verifyservercert === true)
			}

			// Define functions called by MQTT in and out nodes
			let node = this

			this.node.on('close', function (done) {
				this.closing = true
				if (this.connected) {
					this.client.once('close', function () {
						done()
					})
					this.client.end()
				} else if (this.connecting || node.client.reconnecting) {
					node.client.end()
					done()
				} else {
					done()
				}
			})
		}


		update(node) {
			this.node = node
			this.broker = node.mqttIp
			this.port = node.mqttPort
			this.usetls = node.usetls
			this.usews = node.usews
			this.verifyservercert = node.verifyservercert

			if (this.node.credentials) {
				this.username = this.node.credentials.user
				this.password = this.node.credentials.password
			}
		}


		connect() {
			let that = this
			that.node.log('connecting to MQTT')
			if (!that.connected && !that.connecting) {
				that.connecting = true
				try {
					that.client = mqtt.connect(that.brokerurl, that.options)
					that.client.setMaxListeners(0)
					// Register successful connect or reconnect handler
					that.client.on('connect', function () {
						that.connecting = false
						that.connected = true
						for (let id in that.node.users) {
							if (that.node.users.hasOwnProperty(id)) {
								that.node.users[id].status({
									fill: 'green', shape: 'dot', text: 'node-red:common.status.connected'
								})
							}
						}
						// Remove any existing listeners before resubscribing to avoid duplicates in the event of a re-connection
						that.client.removeAllListeners('message')

						// Re-subscribe to stored topics
						for (let s in that.subscriptions) {
							if (that.subscriptions.hasOwnProperty(s)) {
								let topic = s
								let qos = 0
								for (let r in that.subscriptions[s]) {
									if (that.subscriptions[s].hasOwnProperty(r)) {
										qos = Math.max(qos, that.subscriptions[s][r].qos)
										that.client.on('message', that.subscriptions[s][r].handler)
									}
								}
								let options = {qos: qos}
								that.client.subscribe(topic, options)
							}
						}
					})
					that.client.on('reconnect', function () {
						for (let id in that.node.users) {
							if (that.node.users.hasOwnProperty(id)) {
								that.node.users[id].status({
									fill: 'yellow', shape: 'ring', text: 'node-red:common.status.connecting'
								})
							}
						}
					})
					// Register disconnect handlers
					that.client.on('close', function () {
						if (that.connected) {
							that.connected = false
							for (let id in that.node.users) {
								if (that.node.users.hasOwnProperty(id)) {
									that.node.users[id].status({
										fill: 'red', shape: 'ring', text: 'node-red:common.status.disconnected'
									})
								}
							}
						}
					})

					// Register connect error handler
					// The client's own reconnect logic will take care of errors
					that.client.on('error', function (error) {
					})
				} catch (err) {
					that.node.log(err)
				}
			}
		}


		subscribe(topic, qos, callback, ref) {
			ref = ref || 0
			this.subscriptions[topic] = this.subscriptions[topic] || {}
			let sub = {
				topic:  topic, qos: qos, handler: function (mtopic, mpayload, mpacket) {
					if (matchTopic(topic, mtopic)) {
						callback(mtopic, mpayload, mpacket)
					}
				}, ref: ref
			}
			this.subscriptions[topic][ref] = sub
			if (this.connected) {
				this.client.on('message', sub.handler)
				let options = {}
				options.qos = qos
				this.client.subscribe(topic, options)
			}
		};


		unsubscribe(topic, ref, removed) {
			ref = ref || 0
			let sub = this.subscriptions[topic]
			if (sub) {
				if (sub[ref]) {
					this.client.removeListener('message', sub[ref].handler)
					delete sub[ref]
				}
				if (removed && Object.keys(sub).length === 0) {
					delete this.subscriptions[topic]
					if (this.connected) {
						this.client.unsubscribe(topic)
					}
				}
			}
		};


		publish(msg, done) {
			if (this.connected) {
				if (msg.payload === null || msg.payload === undefined) {
					msg.payload = ''
				} else if (!Buffer.isBuffer(msg.payload)) {
					if (typeof msg.payload === 'object') {
						msg.payload = JSON.stringify(msg.payload)
					} else if (typeof msg.payload !== 'string') {
						msg.payload = '' + msg.payload
					}
				}

				let options = {
					qos: msg.qos || 0, retain: msg.retain || false
				}
				this.node.log('publishing')
				this.client.publish(msg.topic, msg.payload, options, function (err) {
					done && done()
				})
			} else {
				this.node.error('Not connected to MQTT')
			}
		};


		getBrokerUrl() {
			if (!this.broker) return this.broker

			let prox, noprox
			if (process.env.http_proxy) {
				prox = process.env.http_proxy
			}
			if (process.env.HTTP_PROXY) {
				prox = process.env.HTTP_PROXY
			}
			if (process.env.no_proxy) {
				noprox = process.env.no_proxy.split(',')
			}
			if (process.env.NO_PROXY) {
				noprox = process.env.NO_PROXY.split(',')
			}

			let url = ''
			// if the broker may be ws:// or wss:// or even tcp://
			if (this.broker.indexOf('://') > -1) {
				url = this.broker
				// Only for ws or wss, check if proxy env var for additional configuration
				if (url.indexOf('wss://') > -1 || url.indexOf('ws://') > -1) {
					// check if proxy is set in env
					if (noprox) {
						for (let i = 0; i < noprox.length; i += 1) {
							if (url.indexOf(noprox[i].trim()) !== -1) {
								noproxy = true
							}
						}
					}
					if (prox && !noproxy) {
						let parsedUrl = url.parse(url)
						let proxyOpts = url.parse(prox)
						// true for wss
						proxyOpts.secureEndpoint = parsedUrl.protocol ? parsedUrl.protocol === 'wss:' : true
						// Set Agent for wsOption in MQTT
						let agent = new HttpsProxyAgent(proxyOpts)
						this.options.wsOptions = {
							agent: agent
						}
					}
				}
			} else {
				// construct the std mqtt:// url
				if (this.usetls) {
					url = '"mqtts://";'
				} else {
					url = 'mqtt://'
				}
				if (this.broker !== '') {
					//Check for an IPv6 address
					if (/(?:^|(?<=\s))(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))(?=\s|$)/.test(this.broker)) {
						url = `${url}[${this.broker}]:`
					} else {
						url = `${url}${this.broker}:`
					}
					// port now defaults to 1883 if unset.
					if (!this.port) {
						url += '1883'
					} else {
						url += this.port
					}
				} else {
					url += 'localhost:1883'
				}
			}
			return url
		}
	}


}
