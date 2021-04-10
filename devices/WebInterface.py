from core.device.model.Device import Device
from core.device.model.DeviceAbility import DeviceAbility
from core.webui.model.DeviceClickReactionAction import DeviceClickReactionAction
from core.webui.model.OnDeviceClickReaction import OnDeviceClickReaction


class WebInterface(Device):

	@classmethod
	def getDeviceTypeDefinition(cls) -> dict:
		return {
			'deviceTypeName'        : 'WebInterface',
			'perLocationLimit'      : 0,
			'totalDeviceLimit'      : 0,
			'allowLocationLinks'    : False,
			'allowHeartbeatOverride': False,
			'heartbeatRate'         : 5,
			'abilities'             : [DeviceAbility.DISPLAY, DeviceAbility.ALERT, DeviceAbility.NOTIFY]
		}


	def onStart(self):
		abilities = self.getDeviceTypeDefinition()['abilities']
		if self.getConfig('canPlayAudio'):
			abilities.append(DeviceAbility.PLAY_SOUND)
		if self.getConfig('canRecordAudio'):
			abilities.append(DeviceAbility.CAPTURE_SOUND)
		if self.getConfig('hasKeyboard'):
			abilities.append(DeviceAbility.KEYBOARD)
			abilities.append(DeviceAbility.PHYSICAL_USER_INPUT)

		self.setAbilities(abilities)


	def onUIClick(self) -> dict:
		return OnDeviceClickReaction(action=DeviceClickReactionAction.NONE.value).toDict()
