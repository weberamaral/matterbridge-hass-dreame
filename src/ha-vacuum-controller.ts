import { EventEmitter } from 'events';
import { HomeAssistantClient, HAState } from './ha-client.js';

export interface VacuumState {
  state: string;
  detailedState: string;
  batteryLevel: number;
  isCharging: boolean;
  fanSpeed?: string;
  cleaningMode?: string;
  error?: string;
  errorMsg?: string;
  currentRoom?: string;
  cleanedArea?: number;
  cleaningTime?: number;
  hepaFilterLife?: number;
  taskStatus?: string;
  rawAttributes: Record<string, any>;
}

interface RoomTimer {
  startTime: number;
  totalTime: number;
}

export class HAVacuumController extends EventEmitter {
  haClient: HomeAssistantClient;
  entityId: string;
  deviceName?: string;
  batterySensorId?: string;
  chargingSensorId?: string;
  cleaningModeEntityId?: string;
  errorSensorId?: string;
  currentRoomSensorId?: string;
  stateSensorId?: string;
  taskStatusSensorId?: string;
  cleanedAreaSensorId?: string;
  cleaningTimeSensorId?: string;
  hepaFilterSensorId?: string;
  roomAreaSizes?: Record<string, number>;
  selectedRoomNames: string[] = [];
  currentState?: VacuumState;

  // 房间时间追踪
  roomTimers = new Map<string, RoomTimer>();
  lastRoom?: string;
  taskStartTime = 0;

  private logPrefix(event: string): string {
    const name = this.deviceName ?? this.entityId;
    return `[Roborock][${name}][${this.entityId}][${event}]`;
  }

  private logInfo(event: string, message: string, ...args: any[]) {
    console.log(`${this.logPrefix(event)} ${message}`, ...args);
  }

  private logWarn(event: string, message: string, ...args: any[]) {
    console.warn(`${this.logPrefix(event)} ${message}`, ...args);
  }

  private logError(event: string, message: string, ...args: any[]) {
    console.error(`${this.logPrefix(event)} ${message}`, ...args);
  }

  constructor(
    haClient: HomeAssistantClient,
    entityId: string,
    batterySensorId?: string,
    chargingSensorId?: string,
    cleaningModeEntityId?: string,
    errorSensorId?: string,
    currentRoomSensorId?: string,
    stateSensorId?: string,
    taskStatusSensorId?: string,
    cleanedAreaSensorId?: string,
    cleaningTimeSensorId?: string,
    hepaFilterSensorId?: string,
    roomAreaSizes?: Record<string, number>,
  ) {
    super();
    this.haClient = haClient;
    this.entityId = entityId;
    this.batterySensorId = batterySensorId;
    this.chargingSensorId = chargingSensorId;
    this.cleaningModeEntityId = cleaningModeEntityId;
    this.errorSensorId = errorSensorId;
    this.currentRoomSensorId = currentRoomSensorId;
    this.stateSensorId = stateSensorId;
    this.taskStatusSensorId = taskStatusSensorId;
    this.cleanedAreaSensorId = cleanedAreaSensorId;
    this.cleaningTimeSensorId = cleaningTimeSensorId;
    this.hepaFilterSensorId = hepaFilterSensorId;
    this.roomAreaSizes = roomAreaSizes;
  }

  setDeviceName(name: string) {
    this.deviceName = name;
  }

  async initialize() {
    await this.updateState();
    this.haClient.on('stateChanged', async (entityId: string, newState: HAState) => {
      if (entityId === this.entityId) {
        await this.handleStateChange(newState);
      } else if (
        entityId === this.batterySensorId ||
        entityId === this.chargingSensorId ||
        entityId === this.cleaningModeEntityId ||
        entityId === this.errorSensorId ||
        entityId === this.currentRoomSensorId ||
        entityId === this.stateSensorId ||
        entityId === this.taskStatusSensorId ||
        entityId === this.cleanedAreaSensorId ||
        entityId === this.cleaningTimeSensorId ||
        entityId === this.hepaFilterSensorId
      ) {
        await this.updateState();
      }
    });
  }

  async updateState() {
    try {
      const entity = await this.haClient.getEntityState(this.entityId);
      await this.handleStateChange(entity);
    } catch (error) {
      this.logError('STATE', 'Failed to update state:', error);
    }
  }

  async handleStateChange(entity: HAState) {
    let batteryLevel = 0;
    if (this.batterySensorId) {
      try {
        const batterySensor = await this.haClient.getEntityState(this.batterySensorId);
        batteryLevel = parseFloat(batterySensor.state) || 0;
      } catch (error) {
        this.logError('SENSOR', 'Failed to get battery sensor:', error);
        batteryLevel = entity.attributes.battery_level || 0;
      }
    } else {
      batteryLevel = entity.attributes.battery_level || 0;
    }

    let isCharging = false;
    if (this.chargingSensorId) {
      try {
        const chargingSensor = await this.haClient.getEntityState(this.chargingSensorId);
        isCharging = chargingSensor.state.toLowerCase() === 'on';
      } catch (error) {
        this.logError('SENSOR', 'Failed to get charging sensor:', error);
        isCharging = entity.state.toLowerCase() === 'charging';
      }
    } else {
      isCharging = entity.state.toLowerCase() === 'charging';
    }

    let cleaningMode: string | undefined = undefined;
    if (this.cleaningModeEntityId) {
      try {
        const cleaningModeEntity = await this.haClient.getEntityState(this.cleaningModeEntityId);
        cleaningMode = cleaningModeEntity.state;
      } catch (error) {
        this.logError('SENSOR', 'Failed to get cleaning mode:', error);
      }
    }

    let errorMsg: string | undefined = undefined;
    if (this.errorSensorId) {
      try {
        const errorSensor = await this.haClient.getEntityState(this.errorSensorId);
        errorMsg = errorSensor.state;
      } catch (error) {
        this.logError('SENSOR', 'Failed to get error sensor:', error);
      }
    }

    let currentRoom: string | undefined = undefined;
    if (this.currentRoomSensorId) {
      try {
        const roomSensor = await this.haClient.getEntityState(this.currentRoomSensorId);
        this.logInfo('ROOM', '当前房间传感器状态:', roomSensor.state);
        if (roomSensor.state && roomSensor.state !== 'unavailable') {
          currentRoom = roomSensor.state;
          this.logInfo('ROOM', `✓ 当前房间: ${currentRoom}`);
        } else {
          this.logWarn('ROOM', `⚠️  当前房间状态无效: ${roomSensor.state}`);
        }
      } catch (error) {
        this.logError('SENSOR', 'Failed to get current room sensor:', error);
      }
    } else {
      this.logWarn('ROOM', '⚠️  未配置当前房间传感器');
    }

    let cleanedArea: number | undefined = undefined;
    if (this.cleanedAreaSensorId) {
      try {
        const areaSensor = await this.haClient.getEntityState(this.cleanedAreaSensorId);
        if (areaSensor.state && areaSensor.state !== 'unavailable') {
          cleanedArea = parseFloat(areaSensor.state) || 0;
        }
      } catch (error) {
        this.logError('SENSOR', 'Failed to get cleaned area sensor:', error);
      }
    }

    let cleaningTime: number | undefined = undefined;
    if (this.cleaningTimeSensorId) {
      try {
        const timeSensor = await this.haClient.getEntityState(this.cleaningTimeSensorId);
        if (timeSensor.state && timeSensor.state !== 'unavailable') {
          cleaningTime = parseFloat(timeSensor.state) || 0;
        }
      } catch (error) {
        this.logError('SENSOR', 'Failed to get cleaning time sensor:', error);
      }
    }

    let hepaFilterLife: number | undefined = undefined;
    if (this.hepaFilterSensorId) {
      try {
        const filterSensor = await this.haClient.getEntityState(this.hepaFilterSensorId);
        if (filterSensor.state && filterSensor.state !== 'unavailable') {
          hepaFilterLife = parseFloat(filterSensor.state) || 0;
        }
      } catch (error) {
        this.logError('SENSOR', 'Failed to get HEPA filter sensor:', error);
      }
    } else if (entity.attributes.filter_left !== undefined) {
      hepaFilterLife = parseFloat(entity.attributes.filter_left) || 0;
    }

    let detailedState = entity.state;
    if (this.stateSensorId) {
      try {
        const stateSensor = await this.haClient.getEntityState(this.stateSensorId);
        if (stateSensor.state && stateSensor.state !== 'unavailable') {
          detailedState = stateSensor.state;
          this.logInfo('STATE', `详细状态: ${detailedState} (来自 ${this.stateSensorId})`);
        }
      } catch (error) {
        this.logError('SENSOR', 'Failed to get state sensor:', error);
      }
    } else {
      this.logInfo('STATE', `主实体状态: entity.state="${entity.state}"`);
    }

    let taskStatus: string | undefined = undefined;
    if (this.taskStatusSensorId) {
      try {
        const taskStatusSensor = await this.haClient.getEntityState(this.taskStatusSensorId);
        if (taskStatusSensor.state && taskStatusSensor.state !== 'unavailable') {
          taskStatus = taskStatusSensor.state;
        }
      } catch (error) {
        this.logError('SENSOR', 'Failed to get task status sensor:', error);
      }
    }

    this.currentState = {
      state: entity.state,
      detailedState: detailedState,
      batteryLevel: batteryLevel,
      isCharging: isCharging,
      fanSpeed: entity.attributes.fan_speed,
      cleaningMode: cleaningMode,
      error: entity.attributes.error,
      errorMsg: errorMsg,
      currentRoom: currentRoom,
      cleanedArea: cleanedArea,
      cleaningTime: cleaningTime,
      hepaFilterLife: hepaFilterLife,
      taskStatus: taskStatus,
      rawAttributes: entity.attributes,
    };

    if (detailedState === 'washing') {
      this.logInfo('STATE', '扫地机正在清洗拖布，暂不开始计时');
      this.emit('stateChanged', this.currentState);
      return;
    }

    const isCleaningState = entity.state === 'cleaning';
    this.updateRoomTimer(currentRoom, isCleaningState);
    this.emit('stateChanged', this.currentState);
  }

  getState() {
    return this.currentState;
  }

  getSelectedRoomNames() {
    return this.selectedRoomNames;
  }

  setSelectedRoomNames(roomNames: string[]) {
    this.selectedRoomNames = roomNames;
  }

  getRoomAreaSizes() {
    return this.roomAreaSizes;
  }

  async forceRefreshState() {
    await this.updateState();
  }

  async start() {
    await this.haClient.callService('vacuum', 'start', {
      entity_id: this.entityId,
    });
  }

  async pause() {
    await this.haClient.callService('vacuum', 'pause', {
      entity_id: this.entityId,
    });
  }

  async stop() {
    await this.haClient.callService('vacuum', 'stop', {
      entity_id: this.entityId,
    });
  }

  async returnToBase() {
    await this.haClient.callService('vacuum', 'return_to_base', {
      entity_id: this.entityId,
    });
  }

  async locate() {
    try {
      await this.haClient.callService('vacuum', 'locate', {
        entity_id: this.entityId,
      });
      this.logInfo('COMMAND', '定位命令已发送');
    } catch (error) {
      this.logError('COMMAND', '定位失败:', error);
      throw error;
    }
  }

  async setFanSpeed(speed: string) {
    await this.haClient.callService('vacuum', 'set_fan_speed', {
      entity_id: this.entityId,
      fan_speed: speed,
    });
  }

  async setCleaningModeEntity(mode: string) {
    if (!this.cleaningModeEntityId) {
      throw new Error('Cleaning mode entity ID not configured');
    }
    await this.haClient.callService('select', 'select_option', {
      entity_id: this.cleaningModeEntityId,
      option: mode,
    });
  }

  async setCleaningModeAndFanSpeed(config: { cleaningMode: string; fanSpeed: string }) {
    if (this.cleaningModeEntityId) {
      await this.setCleaningModeEntity(config.cleaningMode);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await this.setFanSpeed(config.fanSpeed);
  }

  async cleanSegments(segments: number[], segmentMap?: Record<number, string>) {
    if (segmentMap) {
      const dreameSegments = segments.map((id) => segmentMap[id]).filter((id) => id !== undefined);
      this.logInfo('COMMAND', `清扫区域: Matter[${segments.join(',')}] → Dreame[${dreameSegments.join(',')}]`);
      await this.haClient.callService('dreame_vacuum', 'vacuum_clean_segment', {
        entity_id: this.entityId,
        segments: dreameSegments,
      });
    } else {
      this.logInfo('COMMAND', `清扫区域: ${segments.join(',')}`);
      await this.haClient.callService('xiaomi_miot', 'call_action', {
        entity_id: this.entityId,
        siid: 18,
        aiid: 1,
        in: segments,
      });
    }
  }

  updateRoomTimer(currentRoom: string | undefined, isCleaningState: boolean) {
    const now = Date.now();
    this.logInfo('TIMER', `updateRoomTimer: currentRoom="${currentRoom}", isCleaningState=${isCleaningState}, lastRoom="${this.lastRoom}", taskStartTime=${this.taskStartTime}`);

    if (isCleaningState && this.taskStartTime === 0) {
      this.taskStartTime = now;
      this.logInfo('TIMER', '开始清扫任务');
    }

    if (!isCleaningState && this.taskStartTime > 0) {
      if (this.lastRoom) {
        const timer = this.roomTimers.get(this.lastRoom);
        if (timer && timer.startTime > 0) {
          timer.totalTime += (now - timer.startTime) / 1000;
          timer.startTime = 0;
          this.logInfo('TIMER', `房间"${this.lastRoom}"清扫完成，总用时: ${Math.floor(timer.totalTime)}秒`);
        }
      }
      this.taskStartTime = 0;
      this.lastRoom = undefined;
      return;
    }

    if (!isCleaningState || !currentRoom) {
      this.logInfo('TIMER', `跳过: isCleaningState=${isCleaningState}, currentRoom="${currentRoom}"`);
      return;
    }

    if (this.lastRoom && this.lastRoom !== currentRoom) {
      const lastTimer = this.roomTimers.get(this.lastRoom);
      if (lastTimer && lastTimer.startTime > 0) {
        lastTimer.totalTime += (now - lastTimer.startTime) / 1000;
        lastTimer.startTime = 0;
        this.logInfo('TIMER', `房间"${this.lastRoom}"清扫完成，用时: ${Math.floor(lastTimer.totalTime)}秒`);
      }
    }

    if (currentRoom !== this.lastRoom) {
      let timer = this.roomTimers.get(currentRoom);
      if (!timer) {
        timer = { startTime: 0, totalTime: 0 };
        this.roomTimers.set(currentRoom, timer);
        this.logInfo('TIMER', `创建新计时器: ${currentRoom}`);
      }
      timer.startTime = now;
      this.logInfo('TIMER', `进入房间"${currentRoom}"，开始计时 (startTime=${now})`);
      this.lastRoom = currentRoom;
    } else {
      this.logInfo('TIMER', `房间未变化: currentRoom="${currentRoom}" === lastRoom="${this.lastRoom}"`);
    }
  }

  getRoomTime(roomName: string): number {
    const timer = this.roomTimers.get(roomName);
    if (!timer) {
      this.logInfo('TIMER', `getRoomTime("${roomName}"): 无计时器记录, 返回 0`);
      return 0;
    }
    let totalTime = timer.totalTime;
    if (timer.startTime > 0) {
      const currentTime = (Date.now() - timer.startTime) / 1000;
      totalTime += currentTime;
      this.logInfo(
        'TIMER',
        `getRoomTime("${roomName}"): totalTime=${timer.totalTime}秒, startTime=${timer.startTime}, 当前额外=${Math.floor(currentTime)}秒, 总计=${Math.floor(totalTime)}秒`,
      );
    } else {
      this.logInfo('TIMER', `getRoomTime("${roomName}"): 计时器未运行 (startTime=0), totalTime=${timer.totalTime}秒`);
    }
    return Math.floor(totalTime);
  }

  resetRoomTimers() {
    this.logInfo('TIMER', '重置房间计时器');
    this.roomTimers.clear();
    this.lastRoom = undefined;
    this.taskStartTime = 0;
  }

  getRoomTimersInfo() {
    const info: Record<string, number> = {};
    for (const [room, timer] of this.roomTimers.entries()) {
      info[room] = this.getRoomTime(room);
    }
    return info;
  }

  destroy() {
    this.removeAllListeners();
  }
}
