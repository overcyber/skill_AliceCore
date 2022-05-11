class ProjectAliceEditor {
	constructor(node, config = {}) {
		this.node = node;
		this.devices = null;
		this.config = Object.assign({
			allow_empty: false
		}, config);
		this.device_id = node.device_id || null;
		this.skill = node.skill || null;
		this.talk = node.talk || null;
		this.intent = node.intent || null;
		this.property = node.state || null;
		this.optionsValue = node.optionsValue || null;
		this.optionsType = node.optionsType || null;
		this.refresh = false;
		return this;
	}

  	bind() {
		let that = this;

		that.getDeviceIdInput().off('change').on('change', () => {
			that.device_id = that.getDeviceIdInput().val();
			that.build();
		});
	}

	getSelection(name) {
		let selectedOptions = $(name+' option:selected');
            if (selectedOptions) {
                return selectedOptions.map(function () {
                    return $(this).val();
                });
            } else {
                return null;
            }
	}

    async build() {
        let that = this;
        // console.log('build : '+(this.refresh?'true':false))
		if(that.getDeviceIdInput().length) {
			await that.buildDeviceIdInput().then(() => {
			});
		}
		if(that.getSkillInput().length) {
			await that.buildSkillInput().then(() => {
			});
			// without a specific skill the others here don't matter!
			// in addition data is only loaded once with skill input
			if(that.getIntentInput().length) {
				await that.buildIntentInput().then(() => {
				});
			}
			if(that.getTalkInput().length) {
				await that.buildTalkInput().then(() => {
				});
			}
		}

        that.bind();
    }

	async buildSkillInput() {
        let that = this;
		let inp = that.getSkillInput()

		await that.getSkills();

        let params = {
            maxHeight: 300,
            dropWidth: 320,
            width: 320,
            filter: true,
			single: true,
			selectAll: false,
			onClose: () => {
				this.skill = that.inp;
				this.skill = that.getSkillInput()[0][this.getSkillInput()[0].selectedIndex].value;
				if(that.getIntentInput()) {
					that.buildIntentInput();
				}
				if(that.getTalkInput()) {
					that.buildTalkInput();
				}
			}
        };

        inp.children().remove();
        inp.multipleSelect('destroy').multipleSelect(params).multipleSelect('disable');

        var names = {};
        let html = '';

        //devices
        if (Object.keys(that.skills).length) {
            html = $('<optgroup/>', {label: 'mySkills!'});//RED._("node-red-contrib-zigbee2mqtt/server:editor.devices")});
            html.appendTo(inp);

            $.each(that.skills, function(name, data) {
                $('<option value="' + name + '" data-friendly_name="' + name + '">' + name + '</option>')
                    .appendTo(html);
            });
        }

        inp.multipleSelect('enable');
        if (that.skill) { //} && $('#node-input-client').find("option[value='Kitchen']").length) {
            inp.val(that.skill);
        } else {
            that.skill = null;
        }

        inp.multipleSelect('refresh')

        return this;

	}

	async buildTalkInput() {
        let that = this;
		let inp = that.getTalkInput()
        if (that.skill && that.skill != that.talkSkill) {
			await that.getTalkTopics();

			let params = {
				maxHeight: 300,
				dropWidth: 320,
				width: 320,
				filter: true,
				single: true,
				selectAll: false
			};

			inp.children().remove();
			inp.multipleSelect('destroy').multipleSelect(params).multipleSelect('disable');

			var names = {};
			let html = '';

			if(Object.keys(that.skills[that.skill]['talks']).length == 0){
           		html = $('<optgroup/>', {label: that.skill});
				html.appendTo(inp);
                $('<option value="' + 0 + '" data-friendly_name="' + 0 + '"> ' + RED._("aliceCore/aliceCore:noTalkTopics") + ' </option>')
                    .appendTo(html);
				inp.multipleSelect('enable');
				inp.multipleSelect('refresh');
				return;
			}

            html = $('<optgroup/>', {label: that.skill});
            html.appendTo(inp);

            $.each(that.skills[that.skill]['talks'], function(index, name) {
                $('<option value="' + name + '" data-friendly_name="' + name + '">' + name + '</option>')
                    .appendTo(html);
            });
        }

        inp.multipleSelect('enable');
        if (that.talk) { //} && $('#node-input-client').find("option[value='Kitchen']").length) {
            inp.val(that.talk);
			that.talkSkill = that.skill
        } else {
            that.talk = null;
        }
        inp.multipleSelect('refresh');

        return this;

	}

	async buildIntentInput() {
        let that = this;
		let inp = that.getIntentInput()
        if (that.skill && that.skill != that.intentSkill) {

			let params = {
				maxHeight: 300,
				dropWidth: 320,
				width: 320,
				filter: true,
				single: true,
				selectAll: false
			};

			inp.children().remove();
			inp.multipleSelect('destroy').multipleSelect(params).multipleSelect('disable');

			var names = {};
			let html = '';

			if(!'intents' in that.skills[that.skill] || !that.skills[that.skill]['intents'] || Object.keys(that.skills[that.skill]['intents']).length == 0){
           		html = $('<optgroup/>', {label: that.skill});
				html.appendTo(inp);
                $('<option value="' + 0 + '" data-friendly_name="' + 0 + '"> ' + RED._("aliceCore/aliceCore:noIntents") + ' </option>')
                    .appendTo(html);
				inp.multipleSelect('enable');
				inp.multipleSelect('refresh');
				return;
			}

            html = $('<optgroup/>', {label: that.skill});
            html.appendTo(inp);
            $.each(that.skills[that.skill]['intents'], function(index, name) {
				let outVal = 'hermes/intent/' + name;
                $('<option value="' + outVal + '" data-friendly_name="' + outVal + '">' + outVal + '</option>')
                    .appendTo(html);
            });
        }

        inp.multipleSelect('enable');
        if (that.intent) { //} && $('#node-input-client').find("option[value='Kitchen']").length) {
            inp.val(that.intent);
			that.intentSkill = that.skill
        } else {
            that.intent = null;
        }
        inp.multipleSelect('refresh');

        return this;

	}

	async buildDeviceIdInput() {
        let that = this;

        let params = {
            maxHeight: 300,
            dropWidth: 320,
            width: 320,
            filter: true,
			selectAll: false
        };
//TODO        if (that.config.allow_empty) {
//TODO            params.formatAllSelected = function(){return RED._("node-red-contrib-zigbee2mqtt/server:editor.msg_topic")};
//TODO        }

        that.getDeviceIdInput().children().remove();
        that.getDeviceIdInput().multipleSelect('destroy').multipleSelect(params).multipleSelect('disable');

        let data = await that.getDevices();

        var names = {};
        let html = '';

        //devices
        let devices = data;
        if (Object.keys(devices).length) {
            html = $('<optgroup/>', {label: 'myDevices!'});//RED._("node-red-contrib-zigbee2mqtt/server:editor.devices")});
            html.appendTo(that.getDeviceIdInput());

            $.each(devices, function(name, uid) {
                $('<option value="' + uid + '" data-friendly_name="' + uid + '">' + name + '</option>')
                    .appendTo(html);
            });
        }

        that.getDeviceIdInput().multipleSelect('enable');
        if (that.device_id) { //} && $('#node-input-client').find("option[value='Kitchen']").length) {
            that.getDeviceIdInput().val(that.device_id);
        } else {
            that.device_id = null;
        }
        that.getDeviceIdInput().multipleSelect('refresh');

        return this;
    }
	async getSkills() {
		let that = this
		if(!that.skills || that.refresh){
			const response = await fetch('AliceCore/getSkills?' + new URLSearchParams({
				controllerID: that.getServerInput().val(),
				forceRefresh: that.refresh
			}).toString(), {
				method: 'GET',
				cache: 'no-cache',
				headers: {
					'Content-Type': 'application/json'
				}
			});
			that.skills = await response.json();
		}
	}

	async getTalkTopics() {
		let that = this
		if(that.skill && that.skill != that.talkSkill && !that.skills['talks'] || that.refresh){
			const response = await fetch('AliceCore/getTalkTopics?' + new URLSearchParams({
				controllerID: that.getServerInput().val(),
				skill: that.skill,
				forceRefresh: that.refresh
			}).toString(), {
				method: 'GET',
				cache: 'no-cache',
				headers: {
					'Content-Type': 'application/json'
				}
			});
			that.skills[that.skill]['talks'] = await response.json();
		}
	}
	async getDevices() {
        let that = this;
		if(!that.devices || that.refresh){
            const response = await fetch('AliceCore/getVoiceDevices?' + new URLSearchParams({
                controllerID: that.getServerInput().val(),
                forceRefresh: that.refresh
            }).toString(), {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            that.refresh = false;
            that.devices = await response.json();
            return that.devices;
        } else {
            return await new Promise(function(resolve, reject) {
                resolve(that.devices);
            });
        }
    }

	getDeviceIdInput() {
        return $('#node-input-device');
    }
	getSkillInput() {
        return $('#node-input-skill');
    }
	getIntentInput() {
        return $('#node-input-intent');
    }
	getTalkInput() {
        return $('#node-input-talk');
    }

	getServerInput() {
        return $('#node-input-connection');
    }
}
