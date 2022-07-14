module.exports = function (RED) { //NOSONAR

	let axios = require('axios')

	function sendNotification(config) {
		RED.nodes.createNode(this, config)

		this.connection = config.connection
		this.config = config
		this.connectionInstance = RED.nodes.getNode(this.connection)
		this.datatype = config.datatype || 'utf8'

		let node = this
		let check = /[+#]/
		let sayMessage = ''

		if (this.connectionInstance) {
			this.status({
				fill:  'red',
				shape: 'ring',
				text:  'node-red:common.status.disconnected'
			})

			this.on('input', function (msg, send, done) {
				node.status({
					fill:  'yellow',
					shape: 'dot',
					text:  'sendNotification.waiting'
				})
				let url = `http://${node.connectionInstance.config.apiIp}:${node.connectionInstance.config.apiPort}/api/v1.0.1/utils/addNotification/`
				let data = new URLSearchParams()
				let header = node.config.headerOverwrite || msg.header
				let message = node.config.messageOverwrite || msg.message
				let key = node.config.keyOverwrite || msg.key
				let device = msg.device || 'all'
				node.log(`Sending notification [${key}] ${header}`)
				data.append('header', header)
				data.append('message', message)
				data.append('key', key)
				data.append('device', device)
				let response = axios({
					method:  'PUT',
					url:     url,
					data:    data,
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'auth':         node.connectionInstance.credentials.apiToken
					}
				}).catch((err) => {
					node.error(err)
					node.status({
						fill:  'red',
						shape: 'dot',
						text:  err
					})
				}).then(() => {
					node.status({
						fill:  'green',
						shape: 'dot',
						text:  'node-red:common.status.connected'
					})
				})
			})

			if (this.connectionInstance) {
				this.connectionInstance.register(this)
			}

			this.on('close', function (done) {
				if (node.connectionInstance) {
					node.connectionInstance.deregister(node, done)
				} else {
					node.info('No valid API connection to deregister!')
				}
				done()
			})

			if (this.connectionInstance.mqtt && this.connectionInstance.mqtt.connected) {
				this.status({
					fill:  'yellow',
					shape: 'dot',
					text:  'sendNotification.waiting'
				})
			}

		} else {
			this.error(RED._('sendNotification.missingConfig'))
		}
	}

	RED.nodes.registerType('sendNotification', sendNotification)
}
