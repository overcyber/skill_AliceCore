module.exports = function (RED) { //NOSONAR
	function sayRandom(config) {
		RED.nodes.createNode(this, config);

		this.topic = 'hermes/dialogueManager/startSession';
		this.connection = config.connection;
		this.connectionInstance = RED.nodes.getNode(this.connection);
		this.datatype = config.datatype || 'utf8';

		let node = this;
		let check = /[+#]/;
		let sayMessage = ""

		if (this.connectionInstance) {
			this.status({
				fill: 'red',
				shape: 'ring',
				text: 'node-red:common.status.disconnected'
			});

			this.on('input', function (msg, send, done) {
				let replace = []
				if(config.replaceOverwrite)
					replace = config.replaceOverwrite
				else
					replace = msg.payload['replace']

				msg.qos = 0;
				msg.retain = false;
				msg.topic = node.topic;

				let replaceSplit = replace ? replace.split(',') : [];
				msg.payload = {
					'siteId': config.device,
					'init': {
						'type': 'notification',
						'skill': config.skill,
						'talk': config.talk,
						'replace': replaceSplit,
						'sendIntentNotRecognized': true,
						'canBeEnqueued': true
					},
					'customData': {}
				};
				//node.send(msg)
				if (check.test(msg.topic)) {
					node.warn(RED._('sayRandom.invalidTopic'));
				} else {
					node.connectionInstance.mqtt.publish(msg, done);

					node.status({
						fill: 'green',
						shape: 'dot',
						text: config.say
					});

					setTimeout(function () {
						node.status({
							fill : 'yellow',
							shape: 'dot',
							text : 'sayRandom.waiting'
						});
					}, 3000);
				}
			});


			if (this.connectionInstance) {
				this.connectionInstance.register(this);
			}

			this.on('close', function (done) {
				if (node.connectionInstance) {
					node.connectionInstance.deregister(node, done);
				} else {
					node.info('No valid Mqtt connection to deregister!');
				}
				done()
			});

			if (this.connectionInstance.mqtt && this.connectionInstance.mqtt.connected) {
				this.status({
					fill : 'yellow',
					shape: 'dot',
					text : 'sayRandom.waiting'
				});
			}

		} else {
			this.error(RED._('sayRandom.missingConfig'));
		}
	}

	RED.nodes.registerType('sayRandom', sayRandom);
};
