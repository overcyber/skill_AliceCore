/**
 * This is almost a copy of the official Nore-red MQTT out node found on node-red repository.
 * It's been fitted to our needs of simplicity for everyday use and repackaged
 */

module.exports = function (RED) {
	function sendMsg(config) {
		RED.nodes.createNode(this, config)

		this.topic = config.topic.includes('/') ? `${config.topic}` : `projectalice/interface/${config.topic}`
		this.broker = config.broker
		this.brokerInstance = RED.nodes.getNode(this.broker)
		this.datatype = config.datatype || 'utf8'

		let node = this
		let check = /[+#]/

		if (this.brokerInstance) {
			this.status({
				fill:  'red',
				shape: 'ring',
				text:  'node-red:common.status.disconnected'
			})

			this.on('input', function (msg, send, done) {
				msg.qos = 0
				msg.retain = false
				msg.topic = node.topic

				if (check.test(msg.topic)) {
					node.warn(RED._('sendMsg.invalidTopic'))
				} else {
					node.brokerInstance.publish(msg, done)

					node.status({
						fill:  'yellow',
						shape: 'dot'
					})

					setTimeout(function () {
						node.status({
							fill:  'green',
							shape: 'dot',
							text:  'node-red:common.status.connected'
						})
					}, 1500)
				}
			})

			if (this.brokerInstance.connected) {
				this.status({
					fill:  'green',
					shape: 'dot',
					text:  'node-red:common.status.connected'
				})
			}
			this.brokerInstance.register(this)

			this.on('close', function (done) {
				if (node.brokerInstance) {
					node.brokerInstance.deregister(node, done)
				}
			})

		} else {
			this.error(RED._('sendMsg.missingConfig'))
		}
	}

	RED.nodes.registerType('sendMsg', sendMsg)
}
