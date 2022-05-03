module.exports = function (RED) { //NOSONAR

	let axios = require('axios');
	function sendNotification(config) {
		RED.nodes.createNode(this, config);

		this.connection = config.connection;
		this.config = config
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
				let url = `http://${node.connectionInstance.config.apiIp}:${node.connectionInstance.config.apiPort}/api/v1.0.1/utils/addNotification/`
				node.log(`Sending notification ` + url)
				let data = new URLSearchParams();
				data.append('header', node.config.headerOverwrite)
				data.append('message', node.config.messageOverwrite)
				data.append('key', node.config.keyOverwrite)
				data.append('device', 'all')
				node.log("adding " + data.toString())
				let response = axios({
					method: 'PUT',
					url: url,
					data: data,
					headers: {'Content-Type': 'application/x-www-form-urlencoded',
							  'auth': node.connectionInstance.credentials.apiToken}
				}).catch((err) => {node.error(err)}).then(response => { node.log(response.data)})
				node.status({
					fill: 'green',
					shape: 'dot',
					text: config.say
				});

				setTimeout(function () {
					node.status({
						fill : 'yellow',
						shape: 'dot',
						text : 'sendNotification.waiting'
					});
				}, 3000);
			});

			if (this.connectionInstance) {
				this.connectionInstance.register(this);
			}

			this.on('close', function (done) {
				if (node.connectionInstance) {
					node.connectionInstance.deregister(node, done);
				} else {
					node.info('No valid API connection to deregister!');
				}
				done()
			});

			if (this.connectionInstance.mqtt && this.connectionInstance.mqtt.connected) {
				this.status({
					fill : 'yellow',
					shape: 'dot',
					text : 'sendNotification.waiting'
				});
			}

		} else {
			this.error(RED._('sendNotification.missingConfig'));
		}
	}

	RED.nodes.registerType('sendNotification', sendNotification);
};
