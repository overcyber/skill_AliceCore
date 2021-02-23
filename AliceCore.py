import subprocess
import threading
from pathlib import Path
from typing import Optional

from core.ProjectAliceExceptions import SkillStartDelayed
from core.base.SuperManager import SuperManager
from core.base.model.AliceSkill import AliceSkill
from core.base.model.Intent import Intent
from core.commons import constants
from core.dialog.model.DialogSession import DialogSession
from core.dialog.model.DialogState import DialogState
from core.user.model.AccessLevels import AccessLevel
from core.util.Decorators import IfSetting, Online, MqttHandler
from core.voice.WakewordRecorder import WakewordRecorderState

from core.device.model.DeviceException import MaxDevicePerLocationReached, MaxDeviceOfTypeReached, RequiresWIFISettings


class AliceCore(AliceSkill):
	_INTENT_MODULE_GREETING = 'projectalice/devices/greeting'
	_INTENT_ANSWER_YES_OR_NO = Intent('AnswerYesOrNo')
	_INTENT_ANSWER_ROOM = Intent('AnswerLocation')
	_INTENT_SWITCH_LANGUAGE = Intent('SwitchLanguage')
	_INTENT_UPDATE_ALICE = Intent('DoAliceUpdate', authLevel=AccessLevel.DEFAULT)
	_INTENT_REBOOT = Intent('RebootSystem', authLevel=AccessLevel.DEFAULT)
	_INTENT_STOP_LISTEN = Intent('StopListening')
	_INTENT_ADD_DEVICE = Intent('AddComponent', authLevel=AccessLevel.ADMIN)
	_INTENT_ANSWER_HARDWARE_TYPE = Intent('AnswerHardwareType')
	_INTENT_ANSWER_ESP_TYPE = Intent('AnswerEspType')
	_INTENT_ANSWER_NAME = Intent('AnswerName')
	_INTENT_SPELL_WORD = Intent('SpellWord')
	_INTENT_ADD_USER = Intent('AddNewUser', authLevel=AccessLevel.ADMIN)
	_INTENT_ANSWER_ACCESSLEVEL = Intent('AnswerAccessLevel')
	_INTENT_ANSWER_NUMBER = Intent('AnswerNumber')
	_INTENT_ANSWER_WAKEWORD_CUTTING = Intent('AnswerWakewordCutting')
	_INTENT_WAKEWORD = Intent('CallWakeword')


	def __init__(self):
		self._INTENTS = [
			(self._INTENT_MODULE_GREETING, self.deviceGreetingIntent),
			self._INTENT_ANSWER_YES_OR_NO,
			(self._INTENT_ANSWER_ROOM, self.addDeviceIntent),
			self._INTENT_SWITCH_LANGUAGE,
			(self._INTENT_UPDATE_ALICE, self.aliceUpdateIntent),
			(self._INTENT_REBOOT, self.confirmReboot),
			(self._INTENT_STOP_LISTEN, self.stopListenIntent),
			(self._INTENT_ADD_DEVICE, self.addDeviceIntent),
			(self._INTENT_ANSWER_HARDWARE_TYPE, self.addDeviceIntent),
			(self._INTENT_ANSWER_ESP_TYPE, self.addDeviceIntent),
			self._INTENT_ANSWER_NUMBER,
			self._INTENT_ANSWER_NAME,
			self._INTENT_SPELL_WORD,
			(self._INTENT_ADD_USER, self.addNewUser),
			self._INTENT_ANSWER_ACCESSLEVEL,
			(self._INTENT_ANSWER_WAKEWORD_CUTTING, self.confirmWakewordTrimming),
			(self._INTENT_WAKEWORD, self.confirmWakeword)
		]

		self._INTENT_ANSWER_YES_OR_NO.dialogMapping = {
			'confirmingReboot'                 : self.confirmSkillReboot,
			'confirmingSkillReboot'            : self.reboot,
			'confirmingUsername'               : self.checkUsername,
			'confirmingWhatWasMeant'           : self.updateUtterance,
			'answeringDownloadSuggestedSkill'  : self.answerDownloadSuggestedSkill,
			'confirmingUsernameForNewWakeword' : self.checkUsername,
			'confirmingUsernameForTuneWakeword': self.checkUsername,
			'confirmingWakewordCreation'       : self.createWakeword,
			'confirmingRecaptureAfterFailure'  : self.tryFixAndRecapture,
			'confirmingPinCode'                : self.askCreateWakeword,
		}

		self._INTENT_ANSWER_ACCESSLEVEL.dialogMapping = {
			'confirmingUsername': self.checkUsername
		}

		self._INTENT_ANSWER_NUMBER.dialogMapping = {
			'addingPinCode'              : self.addUserPinCode,
			'userAuth'                   : self.authUser,
			'answeringWakewordTuningType': self.doWakewordTuning
		}

		self._INTENT_ANSWER_NAME.dialogMapping = {
			'addingUser'               : self.confirmUsername,
			'givingNameForNewWakeword' : self.confirmUsername,
			'givingNameForTuneWakeword': self.confirmUsername
		}

		self._INTENT_SPELL_WORD.dialogMapping = {
			'addingUser'               : self.confirmUsername,
			'givingNameForNewWakeword' : self.confirmUsername,
			'givingNameForTuneWakeword': self.confirmUsername
		}

		self._threads = dict()
		self.wakewordTuningFailedTimer: Optional[threading.Timer] = None
		super().__init__(self._INTENTS)


	def onNluIntentNotRecognized(self, session: DialogSession):
		if not self.getAliceConfig('suggestSkillsToInstall'):
			return

		suggestions = self.SkillStoreManager.findSkillSuggestion(session)
		if not suggestions:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.TalkManager.randomTalk('notUnderstood', skill='system'),
				intentFilter=session.intentFilter
			)
			return

		self.endSession(sessionId=session.sessionId)

		suggestions = list(suggestions)
		if len(suggestions) == 1:
			text = self.randomTalk(text='suggestSkillToDownload', replace=[suggestions[0][1]])
		else:
			if len(suggestions) == 2:
				text = self.randomTalk(text='suggestSkillToDownloadMoreThanOne', replace=[suggestions[0][1], suggestions[1][1]])
			else:
				last = suggestions.pop(-1)
				firsts = ', '.join(suggestions)
				text = self.randomTalk(text='suggestSkillToDownloadMoreThanOne', replace=[firsts, last])

		self.ask(
			text=text,
			deviceUid=session.deviceUid,
			intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
			currentDialogState='answeringDownloadSuggestedSkill',
			customData={
				'skills': list(suggestions)
			},
			probabilityThreshold=0.1
		)


	def answerDownloadSuggestedSkill(self, session: DialogSession):
		if not self.Commons.isYes(session):
			self.endSession(sessionId=session.sessionId)
			return

		# TODO Support for chosing between multiple skills
		skill = session.customData['skills'][0][0]
		self.SkillManager.downloadInstallTicket(skillName=skill)

		self.endDialog(
			sessionId=session.sessionId,
			text=self.randomTalk(text='confirmeDownloadingSuggestedSkill')
		)


	def askUpdateUtterance(self, session: DialogSession):
		previousText = session.previousInput
		self.continueDialog(
			sessionId=session.sessionId,
			text=self.randomTalk('isThatWhatYouMeant', replace=[previousText]),
			intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
			currentDialogState='confirmingWhatWasMeant'
		)


	def updateUtterance(self, session: DialogSession):
		if self.Commons.isYes(session):
			session.notUnderstood = 0

			self.DialogTemplateManager.addUtterance(session=session)

			self.endDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('okAddedUtterance')
			)
		else:
			self.endSession(sessionId=session.sessionId)


	def authUser(self, session: DialogSession):
		if 'Number' not in session.slotsAsObjects:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.TalkManager.randomTalk('notUnderstood', skill='system'),
				intentFilter=[self._INTENT_ANSWER_NUMBER],
				currentDialogState='userAuth'
			)
			return

		pin = ''.join([str(int(x.value['value'])) for x in session.slotsAsObjects['Number']])

		user = self.UserManager.getUser(session.customData['user'])
		if not user:
			self.endDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('userAuthUnknown')
			)

		if not user.checkPassword(pin):
			self.endDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('authFailed')
			)
		else:
			user.isAuthenticated = True
			self.endDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('authOk')
			)

		self.ThreadManager.getEvent('authUser').clear()


	def addNewUser(self, session: DialogSession = None):
		if session:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('addUserWhatsTheName'),
				intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
				currentDialogState='addingUser',
				probabilityThreshold=0.1
			)
		else:
			self.ask(
				text=self.randomTalk('addUserWhatsTheName'),
				intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
				currentDialogState='addingUser',
				probabilityThreshold=0.1
			)


	def askCreateWakeword(self, session: DialogSession):
		if 'pinCode' in session.customData:
			if self.Commons.isYes(session):
				self.UserManager.addNewUser(name=session.customData['username'], access=session.customData['accessLevel'], pinCode=session.customData['pinCode'])
			else:
				self.continueDialog(
					sessionId=session.sessionId,
					text=self.randomTalk('addWrongPin'),
					intentFilter=[self._INTENT_ANSWER_NUMBER],
					currentDialogState='addingPinCode'
				)
				return

		self.continueDialog(
			sessionId=session.sessionId,
			text=self.randomTalk('addUserWakeword', replace=[session.customData['username']]),
			intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
			currentDialogState='confirmingWakewordCreation'
		)


	def addUserPinCode(self, session: DialogSession):
		if 'Number' not in session.slotsAsObjects:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.TalkManager.randomTalk('notUnderstood', skill='system'),
				intentFilter=[self._INTENT_ANSWER_NUMBER],
				currentDialogState='addingPinCode',
				probabilityThreshold=0.1
			)
			return

		pin = ''.join([str(int(x.value['value'])) for x in session.slotsAsObjects['Number']])

		if len(pin) != 4:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('addPinInvalid'),
				intentFilter=[self._INTENT_ANSWER_NUMBER],
				currentDialogState='addingPinCode',
				probabilityThreshold=0.1
			)
		else:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('addPinConfirm', replace=[digit for digit in pin]),
				intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
				currentDialogState='confirmingPinCode',
				probabilityThreshold=0.1,
				customData={
					'pinCode': int(pin)
				}
			)


	def confirmWakewordTrimming(self, session: DialogSession):
		if session.slotValue('WakewordCaptureResult') == 'more':
			self.WakewordRecorder.trimMore()

		elif session.slotValue('WakewordCaptureResult') == 'less':
			self.WakewordRecorder.trimLess()

		elif session.slotValue('WakewordCaptureResult') == 'restart':
			self.WakewordRecorder.removeRawSample()
			self.WakewordRecorder.startCapture()
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('restartSample'),
				intentFilter=[self._INTENT_WAKEWORD],
				probabilityThreshold=0.1
			)

			return

		elif session.slotValue('WakewordCaptureResult') == 'ok':
			if self.WakewordRecorder.getLastSampleNumber() < 3:
				self.WakewordRecorder.startCapture()
				self.continueDialog(
					sessionId=session.sessionId,
					text=self.randomTalk('sampleOk', replace=[3 - self.WakewordRecorder.getLastSampleNumber()]),
					intentFilter=[self._INTENT_WAKEWORD],
					probabilityThreshold=0.1
				)
			else:
				self.WakewordRecorder.finalizeWakeword()
				self.endSession(session.sessionId)

				if self._delayed:
					self._delayed = False
					self.ThreadManager.doLater(interval=2, func=self.onStart)

				self.ThreadManager.doLater(interval=3, func=self.say, args=[self.randomTalk('wakewordCaptureDone'), session.deviceUid])
			return

		sample = self.WakewordRecorder.getTrimmedSample()
		self.playSound(
			soundFilename=sample.stem,
			location=sample.parent,
			sessionId=session.sessionId,
			deviceUid=session.deviceUid,
			requestId='checking-wakeword'
		)


	def tryFixAndRecapture(self, session: DialogSession):
		if self.Commons.isYes(session):
			self.WakewordRecorder.tryCaptureFix()
			self.confirmWakewordTrimming(session=session)
			return

		if self._delayed:
			self._delayed = False
			self.ThreadManager.doLater(interval=2, func=self.onStart)

		self.WakewordRecorder.cancelWakeword()
		self.endDialog(sessionId=session.sessionId, text=self.randomTalk('cancellingWakewordCapture'))


	def confirmWakeword(self, session: DialogSession):
		file = Path(self.AudioServer.LAST_USER_SPEECH.format(session.user, session.deviceUid))
		if not file.exists():
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('wakewordCaptureFailed'),
				intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
				currentDialogState='confirmingRecaptureAfterFailure',
				probabilityThreshold=0.1
			)
			return

		self.WakewordRecorder.addRawSample(file)
		sample = self.WakewordRecorder.getTrimmedSample()
		self.playSound(
			soundFilename=sample.stem,
			location=sample.parent,
			sessionId=session.sessionId,
			deviceUid=session.deviceUid,
			requestId='checking-wakeword'
		)


	def onPlayBytesFinished(self, requestId: str, deviceUid: str, sessionId: str = None):
		if self.WakewordRecorder.state != WakewordRecorderState.CONFIRMING:
			return

		if requestId != 'checking-wakeword':
			return

		text = 'howWasTheCapture' if self.WakewordRecorder.getLastSampleNumber() == 1 else 'howWasThisCapture'
		self.continueDialog(
			sessionId=sessionId,
			text=self.randomTalk(text),
			intentFilter=[self._INTENT_ANSWER_WAKEWORD_CUTTING],
			slot='WakewordCaptureResult',
			currentDialogState='confirmingCaptureResult',
			probabilityThreshold=0.1
		)


	def addNewWakeword(self):
		self.ask(
			text=self.randomTalk(text='addWakewordWhatUser'),
			intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
			probabilityThreshold=0.1,
			currentDialogState='givingNameForNewWakeword'
		)


	def tuneWakeword(self):
		self.ask(
			text=self.randomTalk(text='tuneWakewordWhatUser'),
			intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
			probabilityThreshold=0.1,
			currentDialogState='givingNameForTuneWakeword'
		)


	def confirmUsername(self, session: DialogSession):
		intent = session.intentName

		if intent == self._INTENT_ANSWER_NAME:
			username = session.slots['Name'].lower()
		else:
			username = ''.join([slot.value['value'] for slot in session.slotsAsObjects['Letters']])

		if session.slotRawValue('Name') == constants.UNKNOWN_WORD or not username:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.TalkManager.randomTalk('notUnderstood', skill='system'),
				intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
				currentDialogState=session.currentState,
				probabilityThreshold=0.1
			)
			return

		if session.currentState == DialogState('addingUser'):
			state = 'confirmingUsername'
		elif session.currentState == DialogState('givingNameForNewWakeword'):
			state = 'confirmingUsernameForNewWakeword'
		else:
			state = 'confirmingUsernameForTuneWakeword'

		self.continueDialog(
			sessionId=session.sessionId,
			text=self.randomTalk(text='confirmUsername', replace=[username]),
			intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
			currentDialogState=state,
			probabilityThreshold=0.1,
			customData={
				'username': username
			}
		)


	def checkUsername(self, session: DialogSession):
		currentState = session.currentState
		if currentState == DialogState('confirmingUsername'):
			errorText = 'userAlreadyExist'
			state = 'addingUser'
		elif currentState == DialogState('confirmingUsernameForNewWakeword'):
			errorText = 'addWakewordUserNotExisting'
			state = 'givingNameForNewWakeword'
		else:
			errorText = 'addWakewordUserNotExisting'
			state = 'givingNameForTuneWakeword'

		if not self.Commons.isYes(session):
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('soWhatsTheName'),
				intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
				currentDialogState=state,
				probabilityThreshold=0.1
			)
			return

		if (currentState == DialogState('confirmingUsername') and session.customData['username'] in self.UserManager.getAllUserNames(skipGuests=False)) or \
				((currentState == DialogState('confirmingUsernameForNewWakeword') or currentState == DialogState('confirmingUsernameForTuneWakeword')) and session.customData['username'] not in self.UserManager.getAllUserNames(skipGuests=False)):

			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk(text=errorText, replace=[session.customData['username']]),
				intentFilter=[self._INTENT_ANSWER_NAME, self._INTENT_SPELL_WORD],
				currentDialogState=state,
				probabilityThreshold=0.1
			)
			return

		if currentState == DialogState('confirmingUsername'):
			self.getAccessLevel(session)
		elif currentState == DialogState('confirmingUsernameForNewWakeword'):
			self.createWakeword(session)
		else:
			if not self.WakewordRecorder.getUserWakeword(session.customData['username']):
				self.endDialog(
					sessionId=session.sessionId,
					text=self.randomTalk('tuneWakewordNoWakeword')
				)
				return

			self.askWakewordTuningType(session)


	def getAccessLevel(self, session: DialogSession):
		accessLevel = session.slotValue('UserAccessLevel', defaultValue=session.customData.get('UserAccessLevel'))
		if not accessLevel:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('addUserWhatAccessLevel'),
				intentFilter=[self._INTENT_ANSWER_ACCESSLEVEL],
				currentDialogState='confirmingUsername',
				slot='UserAccessLevel',
				probabilityThreshold=0.1
			)
			return

		self.continueDialog(
			sessionId=session.sessionId,
			text=self.randomTalk('addUserPin'),
			intentFilter=[self._INTENT_ANSWER_NUMBER],
			currentDialogState='addingPinCode',
			probabilityThreshold=0.1,
			customData={
				'accessLevel': accessLevel
			}
		)


	def askWakewordTuningType(self, session: DialogSession):
		self.continueDialog(
			sessionId=session.sessionId,
			text=self.randomTalk('wakewordTuningWhatProblem'),
			intentFilter=[self._INTENT_ANSWER_NUMBER],
			currentDialogState='answeringWakewordTuningType',
			probabilityThreshold=0.1
		)


	def createWakeword(self, session: DialogSession):
		if self.Commons.isYes(session):
			self.WakewordRecorder.newWakeword(username=session.customData['username'])
			self.WakewordRecorder.startCapture()
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('addWakewordAccepted'),
				intentFilter=[self._INTENT_WAKEWORD],
				probabilityThreshold=0.1
			)
		else:
			if self._delayed:
				self._delayed = False
				self.ThreadManager.doLater(interval=2, func=self.onStart)

			self.endDialog(sessionId=session.sessionId, text=self.randomTalk('addWakewordDenied'))


	def doWakewordTuning(self, session: DialogSession):
		if 'Number' not in session.slotsAsObjects:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.TalkManager.randomTalk('notUnderstood', skill='system'),
				intentFilter=[self._INTENT_ANSWER_NUMBER],
				currentDialogState='answeringWakewordTuningType',
				probabilityThreshold=0.1
			)
			return

		username = session.customData['username']
		sensitivity = self.WakewordRecorder.getUserWakewordSensitivity(username)

		if int(session.slotValue('Number')) == 1:
			self.WakewordRecorder.setUserWakewordSensitivity(username=username, sensitivity=sensitivity + 0.05)
			self.ThreadManager.newEvent('TuningWakewordUp').set()
			self.endDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('explainWakewordTuningUp')
			)
		else:
			self.WakewordRecorder.setUserWakewordSensitivity(username=username, sensitivity=sensitivity - 0.03)
			self.ThreadManager.newEvent('TuningWakewordDown').set()
			self.endDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('explainWakewordTuningDown')
			)


	# 5 seconds timer started in onSayFinished


	def wakewordTuningFailed(self, username: str):
		sensitivity = self.WakewordRecorder.getUserWakewordSensitivity(username)

		if self.ThreadManager.getEvent('TuningWakewordUp').is_set():
			if sensitivity + 0.05 > 0.8:
				self.ThreadManager.clearEvent('TuningWakewordUp')
				self.say(
					text=self.randomTalk('tuneWakewordStop')
				)
				self.DialogManager.toggleFeedbackSound(state='on')
				return

			self.WakewordRecorder.setUserWakewordSensitivity(username=username, sensitivity=sensitivity + 0.05)
			self.say(
				text=self.randomTalk('tuneWakewordDidntCatch'),
				customData={
					'username': username
				}
			)
		elif self.ThreadManager.getEvent('TuningWakewordDown').is_set():
			self.WakewordRecorder.setUserWakewordSensitivity(username=username, sensitivity=sensitivity + 0.03)
			self.ThreadManager.clearEvent('TuningWakewordDown')
			self.say(
				text=self.randomTalk('tuneWakewordDownWorked'),
				customData={
					'username': username
				}
			)
			self.DialogManager.toggleFeedbackSound(state='on')


	def stopListenIntent(self, session: DialogSession):
		duration = self.Commons.getDuration(session)
		if duration:
			self.ThreadManager.doLater(interval=duration, func=self.unmuteSite, args=[session.deviceUid])

		if session.deviceUid != self.DeviceManager.getMainDevice().uid:
			self.notifyDevice(constants.TOPIC_DND, deviceUid=session.deviceUid)
		else:
			self.WakewordManager.disableEngine()

		self.endDialog(sessionId=session.sessionId, text='ok')


	def addDeviceIntent(self, session: DialogSession):

		deviceTypeName = session.slotValue('Hardware')
		location = session.slotValue('Location')

		if not deviceTypeName:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('whatHardware'),
				intentFilter=[self._INTENT_ANSWER_HARDWARE_TYPE, self._INTENT_ANSWER_ESP_TYPE],
				currentDialogState='specifyingHardware',
				probabilityThreshold=0.1
			)
			return

		# TODO how to find out the skill name?
		deviceType = self.DeviceManager.getDeviceType(skillName='alicesatellite', deviceType=deviceTypeName)
		if not deviceType:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('unknownHardware'),
				intentFilter=[self._INTENT_ANSWER_HARDWARE_TYPE],
				currentDialogState='specifyingHardware',
				probabilityThreshold=0.1
			)
			return

		if not location:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('whichRoom'),
				intentFilter=[self._INTENT_ANSWER_ROOM],
				currentDialogState='specifyingRoom',
				probabilityThreshold=0.1
			)
			return

		location = self.LocationManager.getLocation(locId=location)

		if not location:
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('whichRoom'),
				intentFilter=[self._INTENT_ANSWER_ROOM],
				currentDialogState='specifyingRoom',
				probabilityThreshold=0.1
			)
			return

		try:
			# TODO if more than one device with same name, ask from what skill
			skillName = 'alicecore'
			for deviceType in self.DeviceManager.deviceTypes.values():
				if deviceType.skillName.lower() == deviceTypeName.lower():
					skillName = deviceType.skillName

			device = self.DeviceManager.addNewDevice(deviceType=deviceTypeName, skillName=skillName, locationId=location.id)

			if self.DeviceManager.startBroadcastingForNewDevice(device=device, replyOnDeviceUid=session.deviceUid):
				self.endDialog(sessionId=session.sessionId, text=self.randomTalk('confirmDeviceAddingMode'))
			else:
				self.endDialog(sessionId=session.sessionId, text=self.randomTalk('busy'))
		except MaxDevicePerLocationReached as e:
			self.logError(f'Failed adding device: {e}')
			self.endDialog(sessionId=session.sessionId, text=self.randomTalk('maxDevicePerLocationReached', replace=[e.maxAmount]))
		except MaxDeviceOfTypeReached as e:
			self.logError(f'Failed adding device: {e}')
			self.endDialog(sessionId=session.sessionId, text=self.randomTalk('maxDeviceOfTypeReached', replace=[e.maxAmount]))
		except RequiresWIFISettings as e:
			self.logError(f'Failed adding device: {e}')
			self.endDialog(sessionId=session.sessionId, text=self.randomTalk('noWifiConf'))
		except Exception as e:
			self.logError(f'Failed adding device: {e}')


	def confirmReboot(self, session: DialogSession):
		self.continueDialog(
			sessionId=session.sessionId,
			text=self.randomTalk('confirmReboot'),
			intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
			currentDialogState='confirmingReboot',
			probabilityThreshold=0.1
		)


	def confirmSkillReboot(self, session: DialogSession):
		if self.Commons.isYes(session):
			self.continueDialog(
				sessionId=session.sessionId,
				text=self.randomTalk('askRebootDevices'),
				intentFilter=[self._INTENT_ANSWER_YES_OR_NO],
				currentDialogState='confirmingSkillReboot',
				probabilityThreshold=0.1
			)
		else:
			self.endDialog(session.sessionId, self.randomTalk('abortReboot'))


	def reboot(self, session: DialogSession):
		value = 'greetAndRebootSkills' if self.Commons.isYes(session) else 'greet'

		self.ConfigManager.updateAliceConfiguration('onReboot', value)
		self.endDialog(session.sessionId, self.randomTalk('confirmRebooting'))
		self.ThreadManager.doLater(interval=5, func=subprocess.run, args=[['sudo', 'shutdown', '-r', 'now']])


	def addFirstUser(self):
		self.UserManager.addNewUser(name='admin', access='admin', state='home', pinCode=self.ConfigManager.getAliceConfigByName('adminPinCode'))
		self.say(
			text=self.randomTalk(text='welcomeToProjectAlice'),
		)

		if self._delayed:
			self._delayed = False
			self.ThreadManager.doLater(interval=1, func=self.onStart)


	def onStart(self):
		super().onStart()

		if not self.UserManager.users:
			if not self._delayed:
				self.logWarning('No user found in database')
				raise SkillStartDelayed(self.name)
			self.addFirstUser()


	def onWakeword(self, deviceUid: str, user: str = constants.UNKNOWN_USER):
		if self.ThreadManager.getEvent('TuningWakewordUp').is_set():
			self.ThreadManager.clearEvent('TuningWakewordUp')
			self.ThreadManager.newEvent(name='TuningWakewordUpWakewordCaught').set()
		elif self.ThreadManager.getEvent('TuningWakewordDown').is_set():
			self.ThreadManager.newEvent(name='TuningWakewordDownWakewordCaught').set()


	def onUserCancel(self, session: DialogSession):
		if self._delayed:
			self._delayed = False

			if self.WakewordRecorder.state != WakewordRecorderState.IDLE:
				self.say(text=self.randomTalk('cancellingWakewordCapture'), deviceUid=session.deviceUid)
				self.ThreadManager.doLater(interval=2, func=self.onStart)

		self.WakewordRecorder.state = WakewordRecorderState.IDLE


	def onSessionStarted(self, session: DialogSession):
		if self.ThreadManager.getEvent('TuningWakewordUpWakewordCaught').is_set():
			if self.wakewordTuningFailedTimer:
				self.wakewordTuningFailedTimer.cancel()

			self.ThreadManager.clearEvent('TuningWakewordUpWakewordCaught')
			self.endSession(sessionId=session.sessionId)
			self.say(text=self.randomTalk(text='tuneWakewordUpWorked'))
			self.DialogManager.toggleFeedbackSound(state='on')

		elif self.ThreadManager.getEvent('TuningWakewordDownWakewordCaught').is_set():
			if self.wakewordTuningFailedTimer:
				self.wakewordTuningFailedTimer.cancel()

			self.ThreadManager.clearEvent('TuningWakewordDownWakewordCaught')
			self.endSession(sessionId=session.sessionId)

			sensitivity = self.WakewordRecorder.getUserWakewordSensitivity(session.user)
			if sensitivity + 0.03 < 0.2:
				self.ThreadManager.clearEvent('TuningWakewordUp')
				self.say(
					text=self.randomTalk('tuneWakewordStop')
				)
				self.DialogManager.toggleFeedbackSound(state='on')
				return

			self.WakewordRecorder.setUserWakewordSensitivity(username=session.user, sensitivity=sensitivity - 0.03)
			self.say(
				text=self.randomTalk(text='tuneWakewordDownFailed'),
				customData={
					'username': session.user
				}
			)
		# 5 seconds timer started in onSayFinished


	def onSleep(self):
		self.MqttManager.toggleFeedbackSounds('off')


	def onWakeup(self):
		self.MqttManager.toggleFeedbackSounds('on')


	def onBooted(self):
		if not super().onBooted():
			return

		onReboot = self.ConfigManager.getAliceConfigByName('onReboot')
		if onReboot:
			if onReboot == 'greet':
				self.ThreadManager.doLater(interval=3, func=self.say, args=[self.randomTalk('confirmRebooted'), 'all'])
			elif onReboot == 'greetAndRebootSkills':
				self.ThreadManager.doLater(interval=3, func=self.say, args=[self.randomTalk('confirmRebootingDevices'), 'all'])
			else:
				self.logWarning('onReboot config has an unknown value')

			self.ConfigManager.updateAliceConfiguration('onReboot', '')


	def onGoingBed(self):
		self.UserManager.goingBed()


	def onLeavingHome(self):
		self.UserManager.leftHome()


	def onReturningHome(self):
		self.UserManager.home()


	def onSayFinished(self, session: DialogSession, uid: str = None):
		if self.ThreadManager.getEvent('TuningWakewordUp').is_set() or self.ThreadManager.getEvent('TuningWakewordDown').is_set():
			self.wakewordTuningFailedTimer = self.ThreadManager.newTimer(interval=5, func=self.wakewordTuningFailed, autoStart=True, kwargs={'username': session.customData['username']})
			self.DialogManager.toggleFeedbackSound(state='off')


	def onAssistantInstalled(self, **kwargs):
		self.say(text=self.randomTalk('confirmBundleUpdate'))


	@IfSetting(settingName='aliceAutoUpdate', settingValue=True)
	def onFullHour(self):
		self.ProjectAlice.updateProjectAlice()


	def deviceGreetingIntent(self, session: DialogSession):
		uid = session.payload.get('uid')
		if not uid:
			self.logWarning('A device tried to connect but is missing information in the payload, refused')
			return

		device = self.DeviceManager.deviceConnecting(uid=uid)
		if device:
			self.logInfo(f'Device with uid {device.uid} of type {device.deviceTypeName} in location {self.LocationManager.getLocationName(locId=device.parentLocation)} connected')
			self.publish(topic=constants.TOPIC_DEVICE_ACCEPTED, payload={'uid': uid})
		else:
			self.logInfo(f'Device with uid {uid} refused')
			self.publish(topic=constants.TOPIC_DEVICE_REFUSED, payload={'uid': uid})


	def onInternetConnected(self):
		if not self.ConfigManager.getAliceConfigByName('keepASROffline') and self.ASRManager.asr.isOnlineASR \
				and not self.UserManager.checkIfAllUser('goingBed') and not self.UserManager.checkIfAllUser('sleeping'):
			self.say(
				text=self.randomTalk('internetBack'),
				deviceUid=constants.ALL
			)


	def onInternetLost(self):
		if not self.ConfigManager.getAliceConfigByName('stayCompletlyOffline') and self.ASRManager.asr.isOnlineASR \
				and not self.UserManager.checkIfAllUser('goingBed') and not self.UserManager.checkIfAllUser('sleeping'):
			self.say(
				text=self.randomTalk('internetLost'),
				deviceUid=constants.ALL
			)


	def onSessionEnded(self, session):
		if self.WakewordRecorder.state != WakewordRecorderState.IDLE and self.WakewordRecorder.state != WakewordRecorderState.FINALIZING:
			self.WakewordRecorder.cancelWakeword()


	@Online(text='noAssistantUpdateOffline')
	def aliceUpdateIntent(self, session: DialogSession):
		self.publish('hermes/leds/systemUpdate')
		updateTypes = {
			'all'      : 1,
			'alice'    : 2,
			'assistant': 3,
			'skills'   : 4
		}
		update = updateTypes.get(session.slotValue('WhatToUpdate', defaultValue='all'), 5)

		self.endDialog(sessionId=session.sessionId, text=self.randomTalk('confirmAssistantUpdate'))
		if update in {1, 5}:
			self.logInfo('Updating system')
			self.ThreadManager.doLater(interval=2, func=self.systemUpdate)

		if update in {1, 4}:
			self.logInfo('Updating skills')
			self.SkillManager.checkForSkillUpdates()

		if update in {1, 2}:
			self.logInfo('Updating Alice')

		if update in {1, 3}:
			self.logInfo('Updating assistant')
			self.logWarning('Not implemented')


	def unmuteSite(self, deviceUid):
		if deviceUid != self.DeviceManager.getMainDevice().uid:
			self.notifyDevice(constants.TOPIC_STOP_DND, deviceUid=deviceUid)
		else:
			self.WakewordManager.enableEngine()

		self.ThreadManager.doLater(interval=1, func=self.say, args=[self.randomTalk('listeningAgain'), deviceUid])


	@staticmethod
	def restart():
		subprocess.run(['sudo', 'systemctl', 'restart', 'ProjectAlice'])


	@staticmethod
	def stop():
		subprocess.run(['sudo', 'systemctl', 'stop', 'ProjectAlice'])


	@classmethod
	def systemUpdate(cls):
		subprocess.run(['sudo', 'apt-get', 'update'])
		subprocess.run(['sudo', 'apt-get', 'dist-upgrade', '-y'])
		subprocess.run(['git', 'stash'])
		subprocess.run(['git', 'pull'])
		subprocess.run(['git', 'stash', 'clear'])
		SuperManager.getInstance().threadManager.doLater(interval=2, func=cls.restart)


	def cancelUnregister(self):
		thread = self._threads.pop('unregisterTimeout', None)
		if thread:
			thread.cancel()


	def langSwitch(self, newLang: str, deviceUid: str):
		self.publish(topic='hermes/asr/textCaptured', payload={'siteId': deviceUid})
		subprocess.run([f'{self.Commons.rootDir()}/system/scripts/langSwitch.sh', newLang])
		self.ThreadManager.doLater(interval=3, func=self._confirmLangSwitch, args=[deviceUid])


	def _confirmLangSwitch(self, deviceUid: str):
		self.publish(topic='hermes/leds/onStop', payload={'device': deviceUid})
		self.say(text=self.randomTalk('langSwitch'), deviceUid=deviceUid)


	@MqttHandler('projectalice/nodered/triggerAction')
	def noderRedAction(self, session: DialogSession):

		playbackDevice = session.payload['deviceUid']
		if not playbackDevice:
			playbackDevice = session.deviceUid

		self.MqttManager.publish(
			topic=constants.TOPIC_TEXT_CAPTURED,
			payload={
				'sessionId': session.sessionId,
				'text'     : session.payload["action"]["text"],
				'deviceUid': playbackDevice,
				'seconds'  : 1
			}
		)
