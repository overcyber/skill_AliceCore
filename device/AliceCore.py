import sqlite3

from core.commons import constants
from core.device.model.Device import Device
from core.device.model.DeviceType import DeviceType
from core.dialog.model.DialogSession import DialogSession


class AliceCore(DeviceType):

	_IMPLEMENTS_HERMES = True

	def __init__(self, data: sqlite3.Row):
		super().__init__(data, self.DEV_SETTINGS, self.LOC_SETTINGS, allowLocationLinks=False, perLocationLimit=1, totalDeviceLimit=1, heartbeatRate=0, internalOnly=True)


	### to reimplement for any device type
	### Find A new Device
	def discover(self, device: Device, uid: str, replyOnSiteId: str = '', session: DialogSession = None) -> bool:
		return device.pairingDone(uid=self.parentSkillInstance.ConfigManager.getAliceConfigByName('uuid'))


	def getDeviceIcon(self, device: Device) -> str:
		return 'AliceCore.png'


	def getDeviceConfig(self):
		# return the custom configuration of that deviceType
		pass


	def toggle(self, device: Device):
		if self.parentSkillInstance.WakewordManager.wakewordEngine.enabled:
			self.parentSkillInstance.WakewordManager.disableEngine()
		else:
			self.parentSkillInstance.WakewordManager.enableEngine()
