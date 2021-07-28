import sqlite3
from typing import Dict, Union

from core.commons import constants
from core.device.model.Device import Device
from core.device.model.DeviceAbility import DeviceAbility


class AliceCore(Device):

	@classmethod
	def getDeviceTypeDefinition(cls) -> dict:
		return {
			'deviceTypeName'        : 'AliceCore',
			'perLocationLimit'      : 1,
			'totalDeviceLimit'      : 1,
			'allowLocationLinks'    : True,
			'allowHeartbeatOverride': False,
			'heartbeatRate'         : 2,
			'abilities'             : [DeviceAbility.PLAY_SOUND, DeviceAbility.CAPTURE_SOUND, DeviceAbility.IS_CORE]
		}


	def __init__(self, data: Union[sqlite3.Row, Dict]):
		super().__init__(data)


	def onStart(self):
		super().onStart()
		if self.getParam('micMuted'):
			self.WakewordManager.disableEngine()
			self.MqttManager.mqttClient.unsubscribe(constants.TOPIC_AUDIO_FRAME.format(self.ConfigManager.getAliceConfigByName('uuid')))


	def onUIClick(self) -> dict:
		if self.getParam('micMuted') and self.getParam('soundMuted'):
			self.WakewordManager.enableEngine()
			self.MqttManager.mqttClient.subscribe(constants.TOPIC_AUDIO_FRAME.format(self.ConfigManager.getAliceConfigByName('uuid')))
			self.updateParams('micMuted', False)
			self.updateParams('soundMuted', True)
		elif self.getParam('micMuted'):
			self.MqttManager.mqttClient.unsubscribe(constants.TOPIC_AUDIO_FRAME.format(self.ConfigManager.getAliceConfigByName('uuid')))
			self.updateParams('soundMuted', True)
		elif self.getParam('soundMuted'):
			self.updateParams('soundMuted', False)
			self.updateParams('micMuted', False)
		else:
			self.WakewordManager.disableEngine()
			self.updateParams('micMuted', True)

		return super().onUIClick()
