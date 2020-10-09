/**
 * Copyright JS Foundation and other contributors,  http://js.foundation
 *
 * Licensed under the Apache License,  Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,  software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,  either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    let mqtt = require("mqtt");
    let util = require("util");
    let isUtf8 = require('is-utf8');
    let HttpsProxyAgent = require('https-proxy-agent');
    let url = require('url');

    function SendMQTTNode(n) {
        RED.nodes.createNode(this, n);
        this.topic = n.topic;
        this.qos = n.qos || null;
        this.retain = n.retain;
        this.broker = n.broker;
        this.brokerConn = RED.nodes.getNode(this.broker);
        let node = this;
        let chk = /[\+#]/;

        if (this.brokerConn) {
            this.status({fill:"red", shape:"ring", text:"node-red:common.status.disconnected"});
            this.on("input", function(msg, send, done) {
                if (msg.qos) {
                    msg.qos = parseInt(msg.qos);
                    if ((msg.qos !== 0) && (msg.qos !== 1) && (msg.qos !== 2)) {
                        msg.qos = null;
                    }
                }
                msg.qos = Number(node.qos || msg.qos || 0);
                msg.retain = node.retain || msg.retain || false;
                msg.retain = ((msg.retain === true) || (msg.retain === "true")) || false;
                if (node.topic) {
                    msg.topic = node.topic;
                }
                if ( msg.hasOwnProperty("payload")) {
                    if (msg.hasOwnProperty("topic") && (typeof msg.topic === "string") && (msg.topic !== "")) { // topic must exist
                        if (chk.test(msg.topic)) { node.warn(RED._("mqtt.errors.invalid-topic")); }
                        this.brokerConn.publish(msg,  done);  // send the message
                    } else {
                        node.warn(RED._("mqtt.errors.invalid-topic"));
                        done();
                    }
                } else {
                    done();
                }
            });
            if (this.brokerConn.connected) {
                node.status({fill:"green", shape:"dot", text:"node-red:common.status.connected"});
            }
            node.brokerConn.register(node);
            this.on('close',  function(done) {
                node.brokerConn.deregister(node, done);
            });
        } else {
            this.error(RED._("mqtt.errors.missing-config"));
        }
    }
    RED.nodes.registerType("send mqtt msg", SendMQTTNode);
};
