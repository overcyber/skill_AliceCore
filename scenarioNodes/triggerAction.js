/**
 * This is almost a copy of the official Nore-red MQTT out node found on node-red repository.
 * It's been fitted to our needs of simplicity for everyday use and repackaged
 */

module.exports = function (RED) { //NOSONAR
	function triggerAction(config) {
		RED.nodes.createNode(this, config);

		this.topic = 'projectalice/nodered/triggerAction';
		this.broker = config.broker;
		this.brokerInstance = RED.nodes.getNode(this.broker);
		this.datatype = config.datatype || 'utf8';

		let node = this;
		let check = /[+#]/;
		let inputText = "";

		if (this.brokerInstance) {
			this.status({
				fill: 'red',
				shape: 'ring',
				text: 'node-red:common.status.disconnected'
			});

			this.on('input', function (msg, send, done) {

				if ((msg.payload.message) && (!config.triggerAction)) {
					inputText = msg.payload.message
				} else {
					inputText = config.triggerAction
				}

				msg.qos = 0;
				msg.retain = false;
				msg.topic = node.topic;

				msg.payload = {
					'siteId': config.client,
					'action': {
						'text': inputText
					}
				};
				node.send(msg)
				if (check.test(msg.topic)) {
					node.warn(RED._('triggerAction.invalidTopic'));
				} else {
					node.brokerInstance.publish(msg, done);
					node.send(msg)

					node.status({
						fill: 'green',
						shape: 'dot',
						text: config.triggerAction
					});

					setTimeout(function () {
						node.status({
							fill: 'yellow',
							shape: 'dot',
							text: 'onAliceEvent.waiting'
						});
					}, 3000);
				}
			});

			if (this.brokerInstance.connected) {
				this.status({
					fill: 'yellow',
					shape: 'dot',
					text: 'onAliceEvent.waiting'
				});
			}
			this.brokerInstance.register(this);

			this.on('close', function (done) {
				if (node.brokerInstance) {
					node.brokerInstance.deregister(node, done);
				}
			});

		} else {
			this.error(RED._('triggerAction.missingConfig'));
		}
	}

	RED.nodes.registerType('triggerAction', triggerAction);
};
