from core.device.model.Device import Device
from core.device.model.DeviceAbility import DeviceAbility
from core.webui.model.ClickReactionAction import ClickReactionAction
from core.webui.model.OnClickReaction import OnClickReaction


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
			'abilities'             : [DeviceAbility.DISPLAY, DeviceAbility.ALERT, DeviceAbility.PHYSICAL_USER_INPUT]
		}

	def onUIClick(self) -> dict:
		return OnClickReaction(action=ClickReactionAction.NONE.value).toDict()
