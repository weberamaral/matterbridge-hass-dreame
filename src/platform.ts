/* eslint-disable @typescript-eslint/no-explicit-any */
import { HomeAssistantClient } from './ha-client.js';
import { HAVacuumController, VacuumState } from './ha-vacuum-controller.js';
import { validateConfig, RoborockHAConfig } from './platform-config.js';

// Import from matterbridge using the package exports
const matterbridgeIndex = await import('matterbridge');
const matterbridgeDevices = await import('matterbridge/devices');
const matterbridgeClusters = await import('matterbridge/matter/clusters');

const MatterbridgeAccessoryPlatform = matterbridgeIndex.MatterbridgeAccessoryPlatform as any;
const RoboticVacuumCleaner = matterbridgeDevices.RoboticVacuumCleaner as any;
const { RvcCleanMode, RvcRunMode, RvcOperationalState, ServiceArea, PowerSource, HepaFilterMonitoring, ResourceMonitoring } = matterbridgeClusters as any;
const { MatterbridgeServiceAreaServer, MatterbridgeHepaFilterMonitoringServer } = matterbridgeIndex as any;

// Extend RoboticVacuumCleaner to add Progress Reporting support (Matter 1.4.2 feature)
class RoboticVacuumCleanerWithProgress extends RoboticVacuumCleaner {
  constructor(...args: any[]) {
    super(...(args as any));
  }

  createDefaultServiceAreaClusterServer(supportedAreas: any[], selectedAreas: any[], currentArea: any, supportedMaps: any[]) {
    // Enable both Maps and ProgressReporting features per Matter 1.4.2 spec
    this.behaviors.require(MatterbridgeServiceAreaServer.with(ServiceArea.Feature.Maps, ServiceArea.Feature.ProgressReporting), {
      supportedAreas: supportedAreas ?? [],
      selectedAreas: selectedAreas ?? [],
      currentArea: currentArea ?? null,
      supportedMaps: supportedMaps ?? [],
      progress: [],
      estimatedEndTime: null,
    });
    return this;
  }

  createDefaultHepaFilterMonitoringClusterServer(
    condition: number = 100,
    changeIndication: any = ResourceMonitoring.ChangeIndication.Ok,
    inPlaceIndicator?: boolean,
    lastChangedTime?: number | null,
  ) {
    this.behaviors.require(MatterbridgeHepaFilterMonitoringServer.with(ResourceMonitoring.Feature.Condition), {
      condition: condition,
      changeIndication: changeIndication,
      degradationDirection: ResourceMonitoring.DegradationDirection.Down,
      inPlaceIndicator: inPlaceIndicator,
      lastChangedTime: lastChangedTime ?? null,
    });

    return this;
  }
}

/**
 * Safely sets an attribute on a Matter device cluster, catching and logging errors.
 *
 * @param {any} device - The Matter device instance to update
 * @param {any} clusterId - The cluster ID to target
 * @param {string} attribute - The attribute name to set
 * @param {any} value - The value to set on the attribute
 * @param {any} log - Logger instance for error reporting
 * @returns {Promise<void>} Promise that resolves when the attribute is set or error is handled
 */
async function safeSetAttribute(device: any, clusterId: any, attribute: string, value: any, log: any) {
  try {
    const maybePromise = device.setAttribute(clusterId, attribute, value, log);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      return maybePromise.catch((error: any) => {
        if (error?.message?.includes('serviceArea.state')) return;
        log?.debug?.(`setAttribute ${String(attribute)} failed`, error);
      });
    }
  } catch (error: any) {
    if (!error?.message?.includes('serviceArea.state')) {
      log?.debug?.(`setAttribute ${String(attribute)} threw`, error);
    }
  }
  return Promise.resolve();
}

const CLEAN_MODE = {
  VacMopQuiet: 5,
  VacMopQuick: 6,
  VacMopMax: 7,
  VacMopDeep: 8,
  MopQuiet: 31,
  MopQuick: 32,
  MopMax: 33,
  MopDeep: 34,
  VacQuiet: 66,
  VacQuick: 67,
  VacMax: 68,
  VacDeep: 69,
};

const CLEAN_MODE_LABELS: Record<number, string> = {
  [CLEAN_MODE.VacMopQuiet]: 'Pano & Aspira: Silencioso',
  [CLEAN_MODE.VacMopQuick]: 'Pano & Aspira: Rápido',
  [CLEAN_MODE.VacMopMax]: 'Pano & Aspira: Máximo',
  [CLEAN_MODE.VacMopDeep]: 'Pano & Aspira: Profundo',
  [CLEAN_MODE.MopQuiet]: 'Pano: Silencioso',
  [CLEAN_MODE.MopQuick]: 'Pano: Rápido',
  [CLEAN_MODE.MopMax]: 'Pano: Máximo',
  [CLEAN_MODE.MopDeep]: 'Pano: Profundo',
  [CLEAN_MODE.VacQuiet]: 'Aspira: Silencioso',
  [CLEAN_MODE.VacQuick]: 'Aspira: Rápido',
  [CLEAN_MODE.VacMax]: 'Aspira: Máximo',
  [CLEAN_MODE.VacDeep]: 'Aspira: Profundo',
};

const SUPPORTED_RUN_MODES = [
  { label: 'Idle', mode: 1, modeTags: [{ value: RvcRunMode.ModeTag.Idle }] },
  {
    label: 'Cleaning',
    mode: 2,
    modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }],
  },
  {
    label: 'Mapping',
    mode: 3,
    modeTags: [{ value: RvcRunMode.ModeTag.Mapping }],
  },
];

const SUPPORTED_CLEAN_MODES = [
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacMopQuiet],
    mode: CLEAN_MODE.VacMopQuiet,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Quiet }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacMopQuick],
    mode: CLEAN_MODE.VacMopQuick,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Quick }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacMopMax],
    mode: CLEAN_MODE.VacMopMax,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Max }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacMopDeep],
    mode: CLEAN_MODE.VacMopDeep,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.DeepClean }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.MopQuiet],
    mode: CLEAN_MODE.MopQuiet,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Quiet }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.MopQuick],
    mode: CLEAN_MODE.MopQuick,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Quick }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.MopMax],
    mode: CLEAN_MODE.MopMax,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.Max }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.MopDeep],
    mode: CLEAN_MODE.MopDeep,
    modeTags: [{ value: RvcCleanMode.ModeTag.Mop }, { value: RvcCleanMode.ModeTag.DeepClean }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacQuiet],
    mode: CLEAN_MODE.VacQuiet,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Quiet }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacQuick],
    mode: CLEAN_MODE.VacQuick,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Quick }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacMax],
    mode: CLEAN_MODE.VacMax,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Max }],
  },
  {
    label: CLEAN_MODE_LABELS[CLEAN_MODE.VacDeep],
    mode: CLEAN_MODE.VacDeep,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.DeepClean }],
  },
];

const CLEAN_MODE_TO_HA: Record<number, { cleaningMode: string; fanSpeed: string }> = {
  [CLEAN_MODE.VacMopQuiet]: {
    cleaningMode: 'sweeping_and_mopping',
    fanSpeed: 'Silent',
  },
  [CLEAN_MODE.VacMopQuick]: {
    cleaningMode: 'sweeping_and_mopping',
    fanSpeed: 'Standard',
  },
  [CLEAN_MODE.VacMopMax]: {
    cleaningMode: 'sweeping_and_mopping',
    fanSpeed: 'Strong',
  },
  [CLEAN_MODE.VacMopDeep]: {
    cleaningMode: 'sweeping_and_mopping',
    fanSpeed: 'Turbo',
  },
  [CLEAN_MODE.MopQuiet]: { cleaningMode: 'mopping', fanSpeed: 'Silent' },
  [CLEAN_MODE.MopQuick]: { cleaningMode: 'mopping', fanSpeed: 'Standard' },
  [CLEAN_MODE.MopMax]: { cleaningMode: 'mopping', fanSpeed: 'Strong' },
  [CLEAN_MODE.MopDeep]: { cleaningMode: 'mopping', fanSpeed: 'Turbo' },
  [CLEAN_MODE.VacQuiet]: { cleaningMode: 'sweeping', fanSpeed: 'Silent' },
  [CLEAN_MODE.VacQuick]: { cleaningMode: 'sweeping', fanSpeed: 'Standard' },
  [CLEAN_MODE.VacMax]: { cleaningMode: 'sweeping', fanSpeed: 'Strong' },
  [CLEAN_MODE.VacDeep]: { cleaningMode: 'sweeping', fanSpeed: 'Turbo' },
};
/**
 * Converts Home Assistant cleaning mode and fan speed to Matter clean mode.
 *
 * @param {string | undefined} cleaningMode - The cleaning mode from Home Assistant (e.g., 'sweeping', 'mopping', 'sweeping_and_mopping')
 * @param {string | undefined} fanSpeed - The fan speed from Home Assistant (e.g., 'Silent', 'Standard', 'Strong', 'Turbo')
 * @returns {number | undefined} The corresponding Matter clean mode ID, or undefined if no match is found
 */
function getMatterCleanModeFromHA(cleaningMode?: string, fanSpeed?: string): number | undefined {
  if (!cleaningMode || !fanSpeed) {
    return undefined;
  }
  for (const [matterMode, haConfig] of Object.entries(CLEAN_MODE_TO_HA)) {
    if (haConfig.cleaningMode === cleaningMode && haConfig.fanSpeed === fanSpeed) {
      return parseInt(matterMode);
    }
  }
  for (const [matterMode, haConfig] of Object.entries(CLEAN_MODE_TO_HA)) {
    if (haConfig.cleaningMode === cleaningMode && haConfig.fanSpeed === 'Standard') {
      return parseInt(matterMode);
    }
  }
  return undefined;
}

const SUPPORTED_AREAS = [
  {
    areaId: 1,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Lavanderia',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 2,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Cozinha',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 3,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Suíte',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 4,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Quarto',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 7,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Sala',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 6,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Banheiro',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 8,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Entrada',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
  {
    areaId: 9,
    mapId: 1,
    areaInfo: {
      locationInfo: {
        locationName: 'Escritório',
        floorNumber: 1,
        areaType: null,
      },
      landmarkInfo: null,
    },
  },
];

const MATTER_TO_DREAME_SEGMENT: Record<number, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
};

const ROOM_NAME_TO_AREA_ID: Record<string, number | null> = {
  Escritório: 9,
  Banheiro: 6,
  Quarto: 4,
  Suíte: 3,
  Sala: 7,
  Entrada: 8,
  Cozinha: 2,
  Lavanderia: 1,
};

// Standard operational states (ID < 128) should not have operationalStateLabel per Matter spec
const OPERATIONAL_STATES = [
  { operationalStateId: RvcOperationalState.OperationalState.Stopped },
  { operationalStateId: RvcOperationalState.OperationalState.Running },
  { operationalStateId: RvcOperationalState.OperationalState.Paused },
  { operationalStateId: RvcOperationalState.OperationalState.Error },
  { operationalStateId: RvcOperationalState.OperationalState.SeekingCharger },
  { operationalStateId: RvcOperationalState.OperationalState.Charging },
  { operationalStateId: RvcOperationalState.OperationalState.Docked },
];

/**
 * Maps Home Assistant vacuum state to Matter operational state.
 *
 * @param {string} haState - The Home Assistant vacuum state (e.g., 'docked', 'cleaning', 'returning', 'paused')
 * @param {boolean} isCharging - Whether the vacuum is currently charging
 * @param {string} [errorMsg] - Error message from Home Assistant, if any
 * @param {any} [rawAttributes] - Raw attributes object containing additional state information
 * @param {boolean} [isAreaCleaning] - Whether the vacuum is performing area-specific cleaning
 * @param {boolean} [roomChanged] - Whether the current room has changed since the last update
 * @param {string} [detailedState] - Detailed state information (e.g., 'sweeping', 'mopping', 'washing')
 * @param {string} [taskStatus] - Current task status (e.g., 'room_cleaning', 'cleaning')
 * @returns {number} The corresponding Matter operational state ID
 */
function mapHAStateToOperationalState(
  haState: string,
  isCharging: boolean,
  errorMsg?: string,
  rawAttributes?: any,
  isAreaCleaning?: boolean,
  roomChanged?: boolean,
  detailedState?: string,
  taskStatus?: string,
): number {
  if (errorMsg && errorMsg !== 'no_error' && errorMsg !== 'null' && errorMsg !== 'unavailable' && errorMsg !== 'unknown') {
    return RvcOperationalState.OperationalState.Error;
  }
  const normalizedTaskStatus = taskStatus?.toLowerCase();
  const normalizedDetailedState = detailedState?.toLowerCase();
  const isTaskStarted = normalizedTaskStatus === 'room_cleaning' || normalizedTaskStatus === 'cleaning';
  if (normalizedDetailedState === 'washing' && isTaskStarted) {
    return RvcOperationalState.OperationalState.Running;
  }
  if (haState === 'docked') {
    if (isCharging) {
      return RvcOperationalState.OperationalState.Charging;
    }
    return RvcOperationalState.OperationalState.Docked;
  }
  if (haState === 'cleaning') {
    const isActuallyCleaning = detailedState && (detailedState.includes('sweeping') || detailedState.includes('mopping') || detailedState === 'washing');
    if (isCharging && !isActuallyCleaning) {
      return RvcOperationalState.OperationalState.Charging;
    }
    if (rawAttributes?.paused === true) {
      return RvcOperationalState.OperationalState.Paused;
    }
    if (rawAttributes?.running === true) {
      return RvcOperationalState.OperationalState.Running;
    }
    if (rawAttributes?.started === true && rawAttributes?.running === false) {
      if (isActuallyCleaning) {
        return RvcOperationalState.OperationalState.Running;
      }
      return RvcOperationalState.OperationalState.SeekingCharger;
    }
    return RvcOperationalState.OperationalState.Running;
  }
  if (isCharging) {
    return RvcOperationalState.OperationalState.Charging;
  }
  if (haState === 'returning' || rawAttributes?.returning === true) {
    return RvcOperationalState.OperationalState.SeekingCharger;
  }
  if (haState === 'paused' || rawAttributes?.paused === true) {
    return RvcOperationalState.OperationalState.Paused;
  }
  if (rawAttributes?.status) {
    const detailedMap: Record<string, number> = {
      'Cruising': RvcOperationalState.OperationalState.SeekingCharger,
      'Back home': RvcOperationalState.OperationalState.SeekingCharger,
      'Go Charging': RvcOperationalState.OperationalState.SeekingCharger,
      'Segment cleaning': RvcOperationalState.OperationalState.Running,
      'Zone cleaning': RvcOperationalState.OperationalState.Running,
      'Room cleaning': RvcOperationalState.OperationalState.Running,
      'Spot cleaning': RvcOperationalState.OperationalState.Running,
      'Cleaning': RvcOperationalState.OperationalState.Running,
      'Fast mapping': RvcOperationalState.OperationalState.Running,
      'Charging': RvcOperationalState.OperationalState.Charging,
      'Docked': RvcOperationalState.OperationalState.Docked,
      'Idle': RvcOperationalState.OperationalState.Stopped,
      'Paused': RvcOperationalState.OperationalState.Paused,
      'Error': RvcOperationalState.OperationalState.Error,
    };
    if (detailedMap[rawAttributes.status] !== undefined) {
      return detailedMap[rawAttributes.status];
    }
  }
  const stateMap: Record<string, number> = {
    idle: RvcOperationalState.OperationalState.Stopped,
    error: RvcOperationalState.OperationalState.Error,
  };
  return stateMap[haState.toLowerCase()] || RvcOperationalState.OperationalState.Stopped;
}

/**
 *
 * @param haState
 * @param detailedState
 * @param rawAttributes
 */
function mapHAStateToRunMode(haState: string, detailedState?: string, rawAttributes?: any): number {
  const statusText = typeof rawAttributes?.status === 'string' ? rawAttributes.status.toLowerCase() : '';
  const detailedText = typeof detailedState === 'string' ? detailedState.toLowerCase() : '';
  if (statusText.includes('mapping') || detailedText.includes('mapping')) {
    return 3;
  }
  const runModeMap: Record<string, number> = {
    cleaning: 2,
    docked: 1,
    paused: 2,
    idle: 1,
    returning: 1,
    charging: 1,
    error: 1,
  };
  return runModeMap[haState.toLowerCase()] || 1;
}

/**
 * 计算 CountdownTime（剩余时间，单位：秒）
 *
 * @param state 扫地机状态
 * @param detailedState 详细状态
 * @param currentRoom 当前房间
 * @param cleaningTime 已清扫时间（分钟，从 HA 传感器读取）
 * @param progressArray Progress 数组
 * @param roomCleaningDuration 房间清扫时长配置（秒）
 * @param controller 控制器实例
 * @returns 剩余时间（秒），如果无法确定则返回 null
 */
// function calculateCountdownTime(
//   state: string,
//   detailedState: string | undefined,
//   currentRoom: string | undefined,
//   cleaningTime: number | undefined,
//   progressArray: any[],
//   roomCleaningDuration: Record<string, number>,
//   controller: any,
// ): number | null {
//   // 如果已停止或待机，返回 null
//   if (state === 'docked' || state === 'idle') {
//     return null;
//   }

//   // 如果正在返回充电座，可以返回 null 或估算返回时间
//   if (state === 'returning') {
//     return null;
//   }

//   // 如果正在清洗拖布，设置固定时间（2分钟）
//   if (detailedState === 'washing') {
//     return 120;
//   }

//   // 如果正在清扫且有当前房间
//   if (state === 'cleaning' && currentRoom) {
//     // 查找当前房间的进度信息
//     const currentRoomProgress = progressArray.find((p) => p.status === 1); // Operating
//     if (currentRoomProgress && currentRoomProgress.estimatedTime !== null) {
//       // 获取当前房间已清扫时间
//       const roomElapsedTime = controller.getRoomTime(currentRoom) || 0;
//       const estimatedTime = currentRoomProgress.estimatedTime;
//       const remaining = Math.max(0, estimatedTime - roomElapsedTime);
//       return remaining;
//     }

//     // 如果没有 estimatedTime，尝试从 roomCleaningDuration 获取
//     if (roomCleaningDuration[currentRoom]) {
//       const roomElapsedTime = controller.getRoomTime(currentRoom) || 0;
//       const estimatedTime = roomCleaningDuration[currentRoom];
//       const remaining = Math.max(0, estimatedTime - roomElapsedTime);
//       return remaining;
//     }
//   }

//   // 如果正在清扫但没有具体房间信息（全屋清扫）
//   if (state === 'cleaning') {
//     // 计算所有待清扫房间的总预计时间
//     let totalEstimatedTime = 0;
//     for (const progress of progressArray) {
//       if (progress.status === 0 || progress.status === 1) {
//         // Pending or Operating
//         if (progress.estimatedTime !== null) {
//           totalEstimatedTime += progress.estimatedTime;
//         }
//       }
//     }

//     // 如果有总预计时间且有已清扫时间
//     if (totalEstimatedTime > 0 && cleaningTime !== undefined) {
//       const cleaningTimeSeconds = cleaningTime * 60; // 转换为秒
//       const remaining = Math.max(0, totalEstimatedTime - cleaningTimeSeconds);
//       return remaining;
//     }

//     // 如果只有已清扫时间，无法准确估算，返回 null
//     if (cleaningTime !== undefined) {
//       // 可以根据经验值估算，比如平均 10 分钟清扫一个房间
//       // 这里保守处理，返回 null
//       return null;
//     }
//   }

//   // 如果暂停，保持当前的倒计时（实际上暂停时倒计时不应该减少）
//   // 这里我们计算如果恢复后还需要多久
//   if (state === 'paused') {
//     // 与 cleaning 状态相同的逻辑
//     if (currentRoom) {
//       const currentRoomProgress = progressArray.find((p) => p.areaId === ROOM_NAME_TO_AREA_ID[currentRoom]);
//       if (currentRoomProgress && currentRoomProgress.estimatedTime !== null) {
//         const roomElapsedTime = controller.getRoomTime(currentRoom) || 0;
//         const estimatedTime = currentRoomProgress.estimatedTime;
//         const remaining = Math.max(0, estimatedTime - roomElapsedTime);
//         return remaining;
//       }
//     }
//   }

//   // 无法确定，返回 null
//   return null;
// }

/**
 * 根据扫地机状态决定当前阶段
 *
 * @param state HA状态
 * @param detailedState 详细状态
 * @param phaseList 阶段列表（默认：['清扫中', '返回充电座', '清洗拖布', '已完成']）
 * @returns 阶段索引，如果无法确定则返回 null
 */
function determineCurrentPhase(state: string, detailedState?: string, phaseList?: string[]): number | null {
  const phases = phaseList || ['清扫中', '返回充电座', '清洗拖布', '已完成'];

  // 根据状态映射到阶段
  if (state === 'cleaning' || detailedState?.includes('sweeping') || detailedState?.includes('mopping')) {
    // 查找"清扫"相关的阶段
    const cleaningPhaseIndex = phases.findIndex((p) => p.includes('清扫') || p.includes('Cleaning') || p.includes('cleaning'));
    return cleaningPhaseIndex >= 0 ? cleaningPhaseIndex : 0;
  }

  if (state === 'returning' || detailedState?.includes('returning')) {
    // 查找"返回"相关的阶段
    const returningPhaseIndex = phases.findIndex((p) => p.includes('返回') || p.includes('Return') || p.includes('return') || p.includes('回充'));
    return returningPhaseIndex >= 0 ? returningPhaseIndex : 1;
  }

  if (detailedState === 'washing' || detailedState?.includes('wash')) {
    // 查找"清洗"相关的阶段
    const washingPhaseIndex = phases.findIndex((p) => p.includes('清洗') || p.includes('Wash') || p.includes('wash'));
    return washingPhaseIndex >= 0 ? washingPhaseIndex : 2;
  }

  if (state === 'docked' || state === 'idle') {
    // 查找"完成"或"待机"相关的阶段
    const completedPhaseIndex = phases.findIndex((p) => p.includes('完成') || p.includes('Completed') || p.includes('Idle') || p.includes('待机'));
    return completedPhaseIndex >= 0 ? completedPhaseIndex : phases.length - 1;
  }

  // 无法确定，返回 null
  return null;
}

export class RoborockHAPlatform extends MatterbridgeAccessoryPlatform {
  haClient?: HomeAssistantClient;
  vacuumControllers = new Map<string, HAVacuumController>();
  matterDevices = new Map<string, any>();
  hepaFilterSensorMap = new Map<string, string>();
  deviceNames = new Map<string, string>();
  deviceReady = new Map<string, boolean>();
  platformConfig?: RoborockHAConfig;

  constructor(matterbridge: any, log: any, config: any) {
    super(matterbridge, log, config);
    this.log.info('🔧 初始化扫地机插件...');
  }

  private devicePrefix(entityId: string, event: string): string {
    const name = this.deviceNames.get(entityId) ?? entityId;
    return `[Roborock][${name}][${entityId}][${event}]`;
  }

  private logDevice(level: 'info' | 'warn' | 'debug' | 'error', entityId: string, event: string, message: string, ...args: any[]) {
    const prefix = this.devicePrefix(entityId, event);
    const logger = (this.log as any)[level] || this.log.info;
    if (typeof logger === 'function') {
      logger.call(this.log, `${prefix} ${message}`, ...args);
    } else {
      this.log.info(`${prefix} ${message}`, ...args);
    }
  }

  private scheduleInitialSync(entityId: string, device: any, controller: HAVacuumController, fallbackState: VacuumState, selectedAreaIds: number[]) {
    this.deviceReady.set(entityId, false);
    const delayMs = 1500;
    setTimeout(() => {
      this.deviceReady.set(entityId, true);
      void this.initializeDeviceState(entityId, device, controller, fallbackState, selectedAreaIds);
      const currentState = controller.getState() || fallbackState;
      controller.emit('stateChanged', currentState);
    }, delayMs);
  }

  private async initializeDeviceState(entityId: string, device: any, controller: HAVacuumController, fallbackState: VacuumState, selectedAreaIds: number[]) {
    const state = controller.getState() || fallbackState;

    try {
      void safeSetAttribute(device, ServiceArea.Cluster.id, 'selectedAreas', selectedAreaIds, this.log);
    } catch (error) {
      this.logDevice('debug', entityId, 'STATE', '无法设置 selectedAreas:', error);
    }

    try {
      await safeSetAttribute(device, ServiceArea.Cluster.id, 'progress', [], this.log);
      this.logDevice('info', entityId, 'STATE', 'Progress 属性已初始化');
    } catch (error: any) {
      if (!error?.message?.includes('serviceArea.state')) {
        this.logDevice('warn', entityId, 'STATE', 'Progress 属性不可用:', error);
      }
    }

    const initialCleanMode = getMatterCleanModeFromHA(state.cleaningMode, state.fanSpeed);
    if (initialCleanMode !== undefined) {
      try {
        await safeSetAttribute(device, RvcCleanMode.Cluster.id, 'currentMode', initialCleanMode, this.log);
        const cleanModeName = CLEAN_MODE_LABELS[initialCleanMode] || `模式${initialCleanMode}`;
        this.logDevice('info', entityId, 'MODE', `初始清洁模式 → ${cleanModeName} (${state.cleaningMode} + ${state.fanSpeed})`);
      } catch (error) {
        this.logDevice('debug', entityId, 'MODE', '无法设置初始清洁模式:', error);
      }
    }

    this.updateBatteryState(device, state, entityId);

    const initialAreaId = this.getRoomAreaId(state.currentRoom);
    if (initialAreaId !== undefined) {
      try {
        await safeSetAttribute(device, ServiceArea.Cluster.id, 'currentArea', initialAreaId, this.log);
        if (initialAreaId !== null) {
          const areaName = SUPPORTED_AREAS.find((a) => a.areaId === initialAreaId)?.areaInfo?.locationInfo?.locationName;
          this.logDevice('info', entityId, 'AREA', `初始区域 → ${initialAreaId} (${areaName})`);
        } else {
          this.logDevice('info', entityId, 'AREA', `初始区域 → null (${state.currentRoom || '未知'})`);
        }
      } catch (error) {
        this.logDevice('debug', entityId, 'AREA', '无法设置初始 currentArea:', error);
      }
    }

    const roomCleaningDuration = this.platformConfig?.roomCleaningDuration || {};
    const baseAreas = selectedAreaIds.length > 0 ? (selectedAreaIds.map((areaId) => SUPPORTED_AREAS.find((a) => a.areaId === areaId)).filter(Boolean) as any[]) : SUPPORTED_AREAS;
    const initialProgressArray = baseAreas.map((area: any) => {
      const areaId = area.areaId;
      const roomName = area.areaInfo?.locationInfo?.locationName || `区域${areaId}`;
      const fixedDuration = roomCleaningDuration[roomName];
      return {
        areaId,
        status: 0,
        totalOperationalTime: null,
        estimatedTime: fixedDuration || null,
      };
    });

    try {
      await safeSetAttribute(device, ServiceArea.Cluster.id, 'progress', initialProgressArray, this.log);
      this.logDevice('info', entityId, 'STATE', `已设置初始 Progress 数组（所有 ${SUPPORTED_AREAS.length} 个房间待处理）`);
    } catch (error: any) {
      if (!error?.message?.includes('serviceArea.state')) {
        this.logDevice('warn', entityId, 'STATE', '设置初始 Progress 数组失败:', error);
      }
    }

    // 初始化 CountdownTime（所有房间 estimatedTime 之和）
    try {
      const totalRemaining = initialProgressArray
        .map((p: any) => p?.estimatedTime)
        .filter((t: any) => typeof t === 'number')
        .reduce((sum: number, t: number) => sum + t, 0);
      const countdownTime = totalRemaining > 0 ? totalRemaining : totalRemaining === 0 ? 0 : null;
      await safeSetAttribute(device, RvcOperationalState.Cluster.id, 'countdownTime', countdownTime, this.log);
      if (countdownTime === null) {
        this.logDevice('info', entityId, 'COUNTDOWN', '初始 CountdownTime → null（无可用估算）');
      } else {
        this.logDevice('info', entityId, 'COUNTDOWN', `初始 CountdownTime → ${countdownTime}秒`);
      }
    } catch (error) {
      this.logDevice('debug', entityId, 'COUNTDOWN', '无法设置初始 countdownTime:', error);
    }
  }

  getRoomAreaId(roomName?: string): number | null {
    if (!roomName) {
      return null;
    }
    const areaId = ROOM_NAME_TO_AREA_ID[roomName];
    return areaId !== undefined ? areaId : null;
  }

  async onStart(reason?: string) {
    this.log.info(`▶️  启动插件: ${reason || '未知原因'}`);
    this.platformConfig = validateConfig(this.config);
    this.haClient = new HomeAssistantClient(this.platformConfig.haUrl, this.platformConfig.haToken);
    const ok = await this.haClient.testConnection();
    if (!ok) throw new Error('Failed to connect to Home Assistant');
    this.log.info('✅ HA 连接成功');
    try {
      await this.haClient.connectWebSocket();
      this.log.info('✅ WebSocket 实时连接成功');
    } catch {
      this.log.warn('⚠️  WebSocket 连接失败，使用轮询模式');
    }
    await this.discoverDevices(this.platformConfig);
    this.log.info('✅ 插件启动完成\n');
  }

  async discoverDevices(config: RoborockHAConfig) {
    if (!this.haClient) return;
    const vacuums = await this.haClient.getVacuumEntities();
    this.log.info(`🔍 发现 ${vacuums.length} 台扫地机`);
    const filtered = vacuums.filter((v) => {
      if (config.deviceBlacklist?.includes(v.entity_id)) {
        this.log.info(`⏭  跳过 ${v.entity_id} (黑名单)`);
        return false;
      }
      if (config.deviceWhitelist?.length && !config.deviceWhitelist.includes(v.entity_id)) {
        this.log.info(`⏭  跳过 ${v.entity_id} (不在白名单)`);
        return false;
      }
      return true;
    });
    this.log.info(`📝 注册 ${filtered.length} 台设备\n`);
    for (const vacuum of filtered) {
      try {
        await this.registerVacuum(vacuum.entity_id, config);
      } catch (err) {
        this.log.error(`❌ 注册失败 ${vacuum.entity_id}:`, err);
      }
    }
  }

  async registerVacuum(entityId: string, config: RoborockHAConfig) {
    if (!this.haClient) return;
    this.log.info(`[Roborock][${entityId}][DISCOVER] 注册设备`);

    const batterySensorId = config.batterySensorMap?.[entityId];
    const chargingSensorId = config.chargingSensorMap?.[entityId];
    const cleaningModeEntityId = config.cleaningModeEntityMap?.[entityId];
    const errorSensorId = config.errorSensorMap?.[entityId];
    const currentRoomSensorId = config.currentRoomSensorMap?.[entityId];
    const stateSensorId = config.stateSensorMap?.[entityId];
    const taskStatusSensorId = config.taskStatusSensorMap?.[entityId];
    const cleanedAreaSensorId = config.cleanedAreaSensorMap?.[entityId];
    const cleaningTimeSensorId = config.cleaningTimeSensorMap?.[entityId];
    const hepaFilterSensorId = config.hepaFilterSensorMap?.[entityId];
    const selectedMapEntityId = config.selectedMapEntityMap?.[entityId];
    const mapIdMap = { ...(config.mapIdMap?.[entityId] || {}) } as Record<string, number>;
    const fastMappingButtonId = config.fastMappingButtonMap?.[entityId];
    const roomAreaSizes = config.roomAreaSizes;

    // Log sensors...
    if (batterySensorId) this.logDevice('info', entityId, 'SENSOR', `电池: ${batterySensorId}`);
    // ... (skipping verbose logs for brevity in restoration)

    const controller = new HAVacuumController(
      this.haClient,
      entityId,
      batterySensorId,
      chargingSensorId,
      cleaningModeEntityId,
      errorSensorId,
      currentRoomSensorId,
      stateSensorId,
      taskStatusSensorId,
      cleanedAreaSensorId,
      cleaningTimeSensorId,
      hepaFilterSensorId,
      roomAreaSizes,
    );
    await controller.initialize();
    const state = controller.getState();
    if (!state) throw new Error('No vacuum state available');

    const deviceName = state.rawAttributes?.friendly_name || entityId;
    this.deviceNames.set(entityId, deviceName);
    controller.setDeviceName(deviceName);

    this.logDevice(
      'info',
      entityId,
      'STATE',
      `状态:${state.state} | 电量:${state.batteryLevel}% | 充电:${state.isCharging ? '是' : '否'} | ` + `模式:${state.cleaningMode || '无'} | 风速:${state.fanSpeed || '无'}`,
    );

    // 读取地图列表
    let mapList: string[] = [];
    let currentMapId: number | undefined = undefined;
    let currentMapName: string | undefined = undefined;
    if (selectedMapEntityId) {
      try {
        const mapEntity = await this.haClient.getEntityState(selectedMapEntityId);
        if (mapEntity?.attributes?.options && Array.isArray(mapEntity.attributes.options)) {
          mapList = mapEntity.attributes.options;
          currentMapName = typeof mapEntity.state === 'string' ? mapEntity.state : undefined;
          if (typeof mapEntity.attributes.map_id === 'number') {
            currentMapId = mapEntity.attributes.map_id;
            if (currentMapName && mapIdMap[currentMapName] === undefined) {
              mapIdMap[currentMapName] = currentMapId;
              this.logDevice('info', entityId, 'MAP', `自动识别当前地图ID: ${currentMapName} → ${currentMapId}`);
            }
          }
          this.logDevice('info', entityId, 'MAP', `发现 ${mapList.length} 个地图: ${mapList.join(', ')}`);
        } else {
          this.logDevice('warn', entityId, 'MAP', `无法从 ${selectedMapEntityId} 读取地图列表`);
        }
      } catch (error) {
        this.logDevice('error', entityId, 'MAP', `读取地图列表失败:`, error);
      }
    }

    const initialSelectedAreaIds = SUPPORTED_AREAS.map((area) => area.areaId);
    const device = await this.createMatterDevice(
      entityId,
      state,
      controller,
      hepaFilterSensorId,
      config.matterMode,
      mapList,
      mapIdMap,
      currentMapId,
      currentMapName,
      initialSelectedAreaIds,
      fastMappingButtonId,
    );
    await this.registerDevice(device);
    this.vacuumControllers.set(entityId, controller);
    this.matterDevices.set(entityId, device);
    if (hepaFilterSensorId) {
      this.hepaFilterSensorMap.set(entityId, hepaFilterSensorId);
    }

    this.logDevice('info', entityId, 'SYNC', '同步初始状态到 Matter（延后初始化）...');
    this.scheduleInitialSync(entityId, device, controller, state, initialSelectedAreaIds);
    this.logDevice('info', entityId, 'DISCOVER', '注册完成');
  }

  async createMatterDevice(
    entityId: string,
    state: VacuumState,
    controller: HAVacuumController,
    hepaFilterSensorId: string | undefined,
    matterMode: string | undefined,
    mapList: string[] = [],
    mapIdMap: Record<string, number> = {},
    currentMapId?: number,
    currentMapName?: string,
    initialSelectedAreaIds: number[] = SUPPORTED_AREAS.map((area) => area.areaId),
    fastMappingButtonId?: string,
  ) {
    const name = state.rawAttributes?.friendly_name || entityId;
    this.deviceNames.set(entityId, name);
    this.logDevice('info', entityId, 'CREATE', `创建 Matter 设备: ${name}`);
    const initialOperationalState = mapHAStateToOperationalState(state.state, state.isCharging, undefined, undefined, undefined, undefined, state.detailedState, state.taskStatus);
    const initialRunMode = mapHAStateToRunMode(state.state, state.detailedState, state.rawAttributes);

    const resolvedMatterMode = matterMode === 'server' ? 'server' : undefined;

    // 从配置获取 phaseList
    const phaseList = this.platformConfig?.phaseList || ['清扫中', '返回充电座', '清洗拖布', '已完成'];
    const initialPhase = 0; // 默认初始阶段为第一个

    this.logDevice('info', entityId, 'CREATE', `配置的阶段列表: ${phaseList.join(' → ')}`);

    const usedMapIds = new Set<number>();
    const stableMapIdFromName = (name: string): number => {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
      }
      const max = 2147483646;
      return (hash % max) + 1;
    };

    // 创建 MapStruct 数组（优先使用 HA 当前 map_id 和可选配置映射，其它使用稳定 hash）
    const supportedMaps = mapList.map((mapName) => {
      let mapId = mapIdMap[mapName];
      if (mapId === undefined && currentMapName && mapName === currentMapName && typeof currentMapId === 'number') {
        mapId = currentMapId;
      }
      if (mapId === undefined) {
        mapId = stableMapIdFromName(mapName);
      }
      while (usedMapIds.has(mapId)) {
        mapId = (mapId % 2147483646) + 1;
      }
      usedMapIds.add(mapId);
      this.logDevice('info', entityId, 'MAP', `地图映射: ${mapName} → ${mapId}`);
      return { mapId, name: mapName };
    });

    if (supportedMaps.length > 0) {
      this.logDevice('info', entityId, 'CREATE', `配置的地图列表: ${supportedMaps.map((m) => `${m.name}(ID:${m.mapId})`).join(', ')}`);
    }

    let resolvedMapId: number | undefined = undefined;
    if (supportedMaps.length > 0) {
      if (currentMapName) {
        const current = supportedMaps.find((m) => m.name === currentMapName);
        if (current) {
          resolvedMapId = current.mapId;
        }
      }
      if (resolvedMapId === undefined && typeof currentMapId === 'number' && supportedMaps.some((m) => m.mapId === currentMapId)) {
        resolvedMapId = currentMapId;
      }
      if (resolvedMapId === undefined) {
        resolvedMapId = supportedMaps[0].mapId;
      }
      this.logDevice('info', entityId, 'MAP', `当前地图ID: ${resolvedMapId}${currentMapName ? ` (${currentMapName})` : ''}`);
    }

    const supportedAreas =
      supportedMaps.length > 0
        ? SUPPORTED_AREAS.map((area) => ({
            ...area,
            mapId: resolvedMapId,
          }))
        : SUPPORTED_AREAS;

    const device = new RoboticVacuumCleanerWithProgress(
      name as any,
      entityId as any,
      resolvedMatterMode as any,
      initialRunMode as any,
      SUPPORTED_RUN_MODES as any,
      CLEAN_MODE.VacMopQuiet as any,
      SUPPORTED_CLEAN_MODES as any,
      initialPhase as any, // 初始阶段索引
      phaseList as any, // 使用配置的 phaseList
      initialOperationalState as any,
      OPERATIONAL_STATES as any,
      supportedAreas as any,
      [] as any,
      SUPPORTED_AREAS[0]?.areaId as any,
      supportedMaps as any, // 使用动态读取的地图列表
    );

    if (hepaFilterSensorId) {
      try {
        const filterState = await this.haClient?.getEntityState(hepaFilterSensorId);
        if (filterState) {
          let condition: number;

          if (hepaFilterSensorId.startsWith('vacuum.')) {
            condition = Math.min(100, Math.max(0, parseInt(filterState.attributes?.filter_left) || 100));
            this.logDevice('debug', entityId, 'HEPA', `从vacuum实体attributes读取: filter_left = ${filterState.attributes?.filter_left}`);
          } else {
            condition = Math.min(100, Math.max(0, parseInt(filterState.state) || 100));
            this.logDevice('debug', entityId, 'HEPA', `从sensor实体state读取: ${filterState.state}`);
          }

          let changeIndication = ResourceMonitoring.ChangeIndication.Ok;

          if (condition < 10) {
            changeIndication = ResourceMonitoring.ChangeIndication.Critical;
          } else if (condition < 30) {
            changeIndication = ResourceMonitoring.ChangeIndication.Warning;
          }

          device.createDefaultHepaFilterMonitoringClusterServer(condition, changeIndication);

          const statusText = ['正常', '警告', '需更换'][changeIndication];
          this.logDevice('info', entityId, 'HEPA', `初始HEPA滤网 → ${condition}% (${statusText})`);
        } else {
          this.logDevice('debug', entityId, 'HEPA', '无法读取HEPA滤网状态，使用默认值');
          device.createDefaultHepaFilterMonitoringClusterServer();
        }
      } catch (error) {
        this.logDevice('debug', entityId, 'HEPA', 'HEPA滤网状态读取失败，使用默认值:', error);
        device.createDefaultHepaFilterMonitoringClusterServer();
      }
    }

    let selectedAreaIds: number[] = [...initialSelectedAreaIds];
    const skippedAreaIds = new Set<number>();
    const completedAreaIds = new Set<number>();
    let lastRoom = state.currentRoom;
    let isAreaCleaning = false;
    let stateUpdateSuppressUntil = 0;
    let hepaUpdateCounter = 0;
    let progressFrozen = false;
    let lastHaState: string | undefined = undefined;

    //  const roomCleaningDuration = this.platformConfig?.roomCleaningDuration || {};

    device.addCommandHandler('selectAreas', async ({ request }: any) => {
      const { newAreas } = request;
      if (!newAreas || newAreas.length === 0) {
        selectedAreaIds = SUPPORTED_AREAS.map((area) => area.areaId);
        this.logDevice('info', entityId, 'AREA', `选择区域: 全选所有房间 (共${selectedAreaIds.length}个区域)`);
      } else {
        selectedAreaIds = newAreas;
        const areaNames = selectedAreaIds.map((id) => SUPPORTED_AREAS.find((a) => a.areaId === id)?.areaInfo?.locationInfo?.locationName || `Area ${id}`);
        this.logDevice('info', entityId, 'AREA', `选择区域: ${areaNames.join('、')} (共${selectedAreaIds.length}个区域)`);
      }
      const areaNames = selectedAreaIds.map((id) => SUPPORTED_AREAS.find((a) => a.areaId === id)?.areaInfo?.locationInfo?.locationName || `Area ${id}`);
      controller.setSelectedRoomNames(areaNames as string[]);
      skippedAreaIds.clear();
      completedAreaIds.clear();
      progressFrozen = false;
      try {
        void safeSetAttribute(device, ServiceArea.Cluster.id, 'selectedAreas', selectedAreaIds, this.log);
      } catch (error) {
        this.logDevice('debug', entityId, 'STATE', '无法设置 selectedAreas:', error);
      }
      this.updateProgressArray(device, controller, state, selectedAreaIds, skippedAreaIds, completedAreaIds);
    });

    device.addCommandHandler('skipArea' as any, async ({ request }: any) => {
      const { skippedArea } = request;
      skippedAreaIds.add(skippedArea);
      const area = SUPPORTED_AREAS.find((a) => a.areaId === skippedArea);
      const roomName = area?.areaInfo?.locationInfo?.locationName || `区域${skippedArea}`;
      this.logDevice('info', entityId, 'AREA', `跳过区域: ${roomName} (areaId: ${skippedArea})`);
      this.updateProgressArray(device, controller, state, selectedAreaIds, skippedAreaIds, completedAreaIds);
    });

    device.addCommandHandler('pause', async () => {
      this.logDevice('info', entityId, 'COMMAND', '暂停清扫');
      await controller.pause();
    });

    device.addCommandHandler('resume', async () => {
      this.logDevice('info', entityId, 'COMMAND', '继续清扫');
      controller.resetRoomTimers();
      completedAreaIds.clear();
      skippedAreaIds.clear();
      progressFrozen = false;
      if (selectedAreaIds.length > 0) {
        isAreaCleaning = true;
        // const areaNames = selectedAreaIds.map((id) => SUPPORTED_AREAS.find((a) => a.areaId === id)?.areaInfo?.locationInfo?.locationName || `区域${id}`);
        if (selectedAreaIds.length === SUPPORTED_AREAS.length) {
          this.logDevice('info', entityId, 'COMMAND', '→ 全屋清扫模式（全选房间）');
          stateUpdateSuppressUntil = Date.now() + 3000;
          const allRoomNames = SUPPORTED_AREAS.map((a) => a.areaInfo?.locationInfo?.locationName || '');
          controller.setSelectedRoomNames(allRoomNames.filter((n) => n) as string[]);
          await controller.start();
        } else {
          this.logDevice('info', entityId, 'COMMAND', `→ 区域清扫模式 (${selectedAreaIds.length}个区域)`);
          stateUpdateSuppressUntil = Date.now() + 3000;
          await controller.cleanSegments(selectedAreaIds, MATTER_TO_DREAME_SEGMENT);
        }
      } else {
        isAreaCleaning = false;
        this.logDevice('info', entityId, 'COMMAND', '→ 全屋清扫模式');
        const allRoomNames = SUPPORTED_AREAS.map((a) => a.areaInfo?.locationInfo?.locationName || '');
        controller.setSelectedRoomNames(allRoomNames.filter((n) => n) as string[]);
        await controller.start();
      }
    });

    device.addCommandHandler('goHome', async () => {
      this.logDevice('info', entityId, 'COMMAND', '返回充电');
      selectedAreaIds = [];
      isAreaCleaning = false;
      progressFrozen = true;
      try {
        void safeSetAttribute(device, ServiceArea.Cluster.id, 'selectedAreas', selectedAreaIds, this.log);
      } catch (error) {
        this.logDevice('debug', entityId, 'STATE', '无法设置 selectedAreas:', error);
      }
      await controller.returnToBase();
    });

    device.addCommandHandler('identify', async ({ _request }: any) => {
      this.logDevice('info', entityId, 'COMMAND', '定位扫地机');
      try {
        await controller.locate();
        this.logDevice('info', entityId, 'COMMAND', '定位成功');
      } catch (error) {
        this.logDevice('error', entityId, 'COMMAND', '定位失败:', error);
      }
    });

    device.addCommandHandler('changeToMode', async ({ request }: any) => {
      const mode = request.newMode;
      if (mode === 1) {
        this.logDevice('info', entityId, 'MODE', '切换到 Idle 模式 → 返回充电');
        selectedAreaIds = [];
        isAreaCleaning = false;
        progressFrozen = true;
        try {
          void safeSetAttribute(device, ServiceArea.Cluster.id, 'selectedAreas', selectedAreaIds, this.log);
        } catch (error) {
          this.logDevice('debug', entityId, 'STATE', '无法设置 selectedAreas:', error);
        }
        await controller.returnToBase();
        return;
      }
      if (mode === 2) {
        this.logDevice('info', entityId, 'MODE', '切换到 Cleaning 模式 → 开始清扫');
        if (selectedAreaIds.length > 0 && selectedAreaIds.length < SUPPORTED_AREAS.length) {
          isAreaCleaning = true;
          completedAreaIds.clear();
          skippedAreaIds.clear();
          progressFrozen = false;
          controller.resetRoomTimers();
          const areaNames = selectedAreaIds.map((id) => SUPPORTED_AREAS.find((a) => a.areaId === id)?.areaInfo?.locationInfo?.locationName || `区域${id}`);
          const roomNames = areaNames.filter((n) => n && !n.startsWith('区域')) as string[];
          controller.setSelectedRoomNames(roomNames);
          stateUpdateSuppressUntil = Date.now() + 3000;
          await controller.cleanSegments(selectedAreaIds, MATTER_TO_DREAME_SEGMENT);
        } else {
          isAreaCleaning = true;
          completedAreaIds.clear();
          skippedAreaIds.clear();
          progressFrozen = false;
          controller.resetRoomTimers();
          const allRoomNames = SUPPORTED_AREAS.map((a) => a.areaInfo?.locationInfo?.locationName || '').filter((n) => n) as string[];
          controller.setSelectedRoomNames(allRoomNames);
          stateUpdateSuppressUntil = Date.now() + 3000;
          await controller.start();
        }
        return;
      }
      if (mode === 3) {
        if (!fastMappingButtonId) {
          this.logDevice('warn', entityId, 'MODE', '未配置快速建图按钮实体，无法切换到 Mapping 模式');
          return;
        }
        this.logDevice('info', entityId, 'MODE', '切换到 Mapping 模式 → 快速建图');
        try {
          await this.haClient?.callService('button', 'press', {
            entity_id: fastMappingButtonId,
          });
          progressFrozen = true;
          selectedAreaIds = [];
          try {
            void safeSetAttribute(device, ServiceArea.Cluster.id, 'selectedAreas', selectedAreaIds, this.log);
          } catch (error) {
            this.logDevice('debug', entityId, 'STATE', '无法设置 selectedAreas:', error);
          }
        } catch (error) {
          this.logDevice('error', entityId, 'MODE', '快速建图触发失败:', error);
        }
        return;
      }
      const haConfig = CLEAN_MODE_TO_HA[mode];
      if (haConfig) {
        try {
          await controller.setCleaningModeAndFanSpeed(haConfig);
          this.logDevice('info', entityId, 'MODE', '清洁模式切换成功');
        } catch (error) {
          this.logDevice('error', entityId, 'MODE', '清洁模式切换失败:', error);
        }
      } else {
        this.logDevice('warn', entityId, 'MODE', `未知清洁模式: ${mode}`);
      }
    });

    controller.on('stateChanged', (s: VacuumState) => {
      if (!this.deviceReady.get(entityId)) {
        return;
      }
      const errorStr = s.errorMsg ? ` | ❌ ${s.errorMsg}` : '';
      const roomStr = s.currentRoom ? ` | 🏠 ${s.currentRoom}` : '';
      const areaStr = s.cleanedArea !== undefined ? ` | 🧹 ${s.cleanedArea.toFixed(1)}m²` : '';

      this.logDevice(
        'info',
        entityId,
        'STATE',
        `${s.state} | ${s.batteryLevel}% | ${s.isCharging ? '充电中' : '未充电'} | ` + `${s.cleaningMode || '无模式'} | ${s.fanSpeed || '无风速'}${roomStr}${areaStr}${errorStr}`,
      );

      const now = Date.now();
      if (stateUpdateSuppressUntil > 0 && now < stateUpdateSuppressUntil) {
        this.updateBatteryState(device, s, entityId);
        const newOperationalState = mapHAStateToOperationalState(s.state, s.isCharging, s.errorMsg, s.rawAttributes, isAreaCleaning, false, s.detailedState, s.taskStatus);
        try {
          void safeSetAttribute(device, RvcOperationalState.Cluster.id, 'operationalState', newOperationalState, this.log);
        } catch (error) {
          this.logDevice('debug', entityId, 'STATE', '无法更新操作状态:', error);
        }
        return;
      }

      const normalizedError = s.errorMsg && !['no_error', 'null', 'unavailable', 'unknown'].includes(s.errorMsg);
      const isOperatingState = s.state === 'cleaning' || s.state === 'paused';
      const finishedTransition = (lastHaState === 'cleaning' || lastHaState === 'paused') && !isOperatingState && !normalizedError;

      if (normalizedError) {
        for (const areaId of selectedAreaIds) {
          if (!completedAreaIds.has(areaId)) {
            skippedAreaIds.add(areaId);
          }
        }
        progressFrozen = true;
      } else if (finishedTransition) {
        if (s.currentRoom) {
          const currentAreaId = this.getRoomAreaId(s.currentRoom);
          if (currentAreaId !== null && currentAreaId !== undefined) {
            completedAreaIds.add(currentAreaId);
          }
        }
        progressFrozen = true;
      } else if (isOperatingState && progressFrozen) {
        progressFrozen = false;
      }

      const roomChanged = !!(s.currentRoom && lastRoom && s.currentRoom !== lastRoom);
      if (s.detailedState === 'washing') {
        this.logDevice('info', entityId, 'STATE', '扫地机正在清洗拖布，保持"正在前往"状态（不更新 currentArea）');
      } else {
        if (roomChanged) {
          this.logDevice('info', entityId, 'AREA', `房间变化: ${lastRoom} → ${s.currentRoom} (isAreaCleaning: ${isAreaCleaning})`);
          if (lastRoom && isAreaCleaning) {
            const lastAreaId = this.getRoomAreaId(lastRoom);
            const currentAreaId = this.getRoomAreaId(s.currentRoom);
            if (lastAreaId !== null && lastAreaId !== undefined && selectedAreaIds.includes(lastAreaId)) {
              const isForwardProgress = currentAreaId !== null && currentAreaId > lastAreaId;
              if (isForwardProgress) {
                completedAreaIds.add(lastAreaId);
                this.logDevice('info', entityId, 'AREA', `房间已完成: ${lastRoom} (areaId: ${lastAreaId})`);
              }
            }
          }
          const newAreaId = this.getRoomAreaId(s.currentRoom);
          try {
            void safeSetAttribute(device, ServiceArea.Cluster.id, 'currentArea', newAreaId, this.log);
          } catch (error) {
            this.logDevice('debug', entityId, 'AREA', '无法更新 currentArea:', error);
          }
        }
        lastRoom = s.currentRoom;
      }

      if (s.state === 'returning' || s.state === 'docked') {
        isAreaCleaning = false;
      }

      this.updateBatteryState(device, s, entityId);
      const newOperationalState = mapHAStateToOperationalState(s.state, s.isCharging, s.errorMsg, s.rawAttributes, isAreaCleaning, roomChanged, s.detailedState, s.taskStatus);

      if (s.errorMsg && s.errorMsg !== 'no_error' && s.errorMsg !== 'unavailable') {
        const errorInfo = mapDreameErrorToMatter(s.errorMsg);
        if (errorInfo) {
          this.logDevice('info', entityId, 'ERROR', `错误详情: ${errorInfo.errorStateLabel} - ${s.errorMsg}`);
        }
      }

      try {
        void safeSetAttribute(device, RvcOperationalState.Cluster.id, 'operationalState', newOperationalState, this.log);
      } catch (error) {
        this.logDevice('error', entityId, 'STATE', '运行状态更新失败:', error);
      }

      const newRunMode = mapHAStateToRunMode(s.state, s.detailedState, s.rawAttributes);
      try {
        void safeSetAttribute(device, RvcRunMode.Cluster.id, 'currentMode', newRunMode, this.log);
      } catch (error) {
        this.logDevice('error', entityId, 'MODE', '运行模式更新失败:', error);
      }

      const newCleanMode = getMatterCleanModeFromHA(s.cleaningMode, s.fanSpeed);
      if (newCleanMode !== undefined) {
        try {
          void safeSetAttribute(device, RvcCleanMode.Cluster.id, 'currentMode', newCleanMode, this.log);
        } catch (error) {
          this.logDevice('debug', entityId, 'MODE', '无法更新清洁模式:', error);
        }
      }

      // 更新 CurrentPhase
      const currentPhase = determineCurrentPhase(s.state, s.detailedState, phaseList);
      if (currentPhase !== null) {
        try {
          void safeSetAttribute(device, RvcOperationalState.Cluster.id, 'currentPhase', currentPhase, this.log);
          const phaseName = phaseList[currentPhase] || `阶段${currentPhase}`;
          this.logDevice('debug', entityId, 'PHASE', `当前阶段 → ${phaseName} (索引: ${currentPhase})`);
        } catch (error) {
          this.logDevice('debug', entityId, 'PHASE', '无法更新当前阶段:', error);
        }
      }

      if (!progressFrozen || normalizedError) {
        this.updateProgressArray(device, controller, s, selectedAreaIds, skippedAreaIds, completedAreaIds);
      }

      lastHaState = s.state;

      hepaUpdateCounter++;
      if (hepaUpdateCounter >= 30) {
        hepaUpdateCounter = 0;
        const hepaFilterSensorId = this.hepaFilterSensorMap.get(entityId);
        if (hepaFilterSensorId) {
          void this.updateHepaFilterState(device, hepaFilterSensorId, entityId);
        }
      }
    });

    return device;
  }

  updateBatteryState(device: any, state: VacuumState, entityId?: string) {
    try {
      const batPercentRemaining = Math.min(200, Math.max(0, state.batteryLevel * 2));
      const batChargeLevel = state.isCharging ? PowerSource.BatChargeLevel.Ok : state.batteryLevel > 20 ? PowerSource.BatChargeLevel.Ok : PowerSource.BatChargeLevel.Critical;
      const batChargeState = state.isCharging ? PowerSource.BatChargeState.IsCharging : PowerSource.BatChargeState.IsNotCharging;

      void safeSetAttribute(device, PowerSource.Cluster.id, 'batPercentRemaining', batPercentRemaining, this.log);
      void safeSetAttribute(device, PowerSource.Cluster.id, 'batChargeLevel', batChargeLevel, this.log);
      void safeSetAttribute(device, PowerSource.Cluster.id, 'batChargeState', batChargeState, this.log);
    } catch (error) {
      if (entityId) {
        this.logDevice('error', entityId, 'STATE', '电池状态更新失败:', error);
      } else {
        this.log.error('❌ 电池状态更新失败:', error);
      }
    }
  }

  async updateHepaFilterState(device: any, hepaFilterSensorId: string, entityId?: string) {
    if (!hepaFilterSensorId || !this.haClient) {
      return;
    }

    try {
      const filterState = await this.haClient.getEntityState(hepaFilterSensorId);
      if (!filterState) {
        return;
      }

      let condition: number;

      if (hepaFilterSensorId.startsWith('vacuum.')) {
        condition = Math.min(100, Math.max(0, parseInt(filterState.attributes?.filter_left) || 100));
      } else {
        condition = Math.min(100, Math.max(0, parseInt(filterState.state) || 100));
      }

      let changeIndication = ResourceMonitoring.ChangeIndication.Ok;

      if (condition < 10) {
        changeIndication = ResourceMonitoring.ChangeIndication.Critical;
      } else if (condition < 30) {
        changeIndication = ResourceMonitoring.ChangeIndication.Warning;
      }

      void safeSetAttribute(device, HepaFilterMonitoring.Cluster.id, 'condition', condition, this.log);
      void safeSetAttribute(device, HepaFilterMonitoring.Cluster.id, 'changeIndication', changeIndication, this.log);
    } catch (error) {
      if (entityId) {
        this.logDevice('debug', entityId, 'HEPA', 'HEPA滤网状态更新失败:', error);
      } else {
        this.log.debug('HEPA滤网状态更新失败:', error);
      }
    }
  }

  updateProgressArray(device: any, controller: HAVacuumController, state: VacuumState, selectedAreaIds: number[], skippedAreaIds: Set<number>, completedAreaIds: Set<number>) {
    if (selectedAreaIds.length === 0) {
      return;
    }
    if (state.detailedState === 'washing') {
      return;
    }
    const entityId = controller.entityId;

    const roomCleaningDuration = this.platformConfig?.roomCleaningDuration || {};
    const useEstimatedCountdown = !!this.platformConfig?.progressEstimatedTimeCountdown;
    const currentRoom = state.currentRoom;

    const progressArray = selectedAreaIds
      .map((areaId) => SUPPORTED_AREAS.find((a) => a.areaId === areaId))
      .filter((area) => area !== undefined)
      .map((area: any) => {
        const areaId = area.areaId;
        const roomName = area.areaInfo?.locationInfo?.locationName || '';
        const roomTime = controller.getRoomTime(roomName);
        let status;
        if (skippedAreaIds && skippedAreaIds.has(areaId)) {
          status = 2; // Skipped
        } else if (currentRoom === roomName && state.state === 'cleaning') {
          status = 1; // Operating
        } else if (completedAreaIds && completedAreaIds.has(areaId)) {
          status = 3; // Completed
        } else {
          status = 0; // Pending
        }

        const fixedDuration = roomCleaningDuration[roomName];
        let estimatedTime: number | null = null;
        if (fixedDuration !== undefined) {
          if (status === 3 || status === 2) {
            estimatedTime = null;
          } else if (useEstimatedCountdown) {
            estimatedTime = Math.max(0, fixedDuration - roomTime);
          } else {
            estimatedTime = fixedDuration;
          }
        }
        let totalOperationalTime = null;
        if (status === 1 || status === 3) {
          totalOperationalTime = roomTime;
        } else if (status === 2) {
          totalOperationalTime = roomTime > 0 ? roomTime : null;
        }

        return {
          areaId,
          status,
          totalOperationalTime,
          estimatedTime,
        };
      });

    try {
      void safeSetAttribute(device, ServiceArea.Cluster.id, 'progress', progressArray, this.log);
    } catch (error: any) {
      if (error?.message?.includes('serviceArea.state')) {
        this.logDevice('debug', entityId, 'STATE', '忽略 serviceArea.state 属性错误');
      } else {
        this.logDevice('error', entityId, 'STATE', '无法更新 Progress 数组:', error);
      }
    }
    this.updateEstimatedEndTime(device, controller, progressArray, state);
    this.updateCountdownTime(device, controller, progressArray, state, roomCleaningDuration);
  }

  updateEstimatedEndTime(device: any, controller: HAVacuumController, progressArray: any[], state: VacuumState) {
    const entityId = controller.entityId;
    let estimatedEndTime: number | null;
    if (state.state === 'cleaning' || state.state === 'paused') {
      const totalRemaining = progressArray
        .map((p) => p?.estimatedTime)
        .filter((t: any) => typeof t === 'number')
        .reduce((sum: number, t: number) => sum + t, 0);
      if (totalRemaining > 0) {
        // Convert relative seconds to absolute Unix timestamp (epoch-s)
        // Matter spec requires epoch-s >= 946684800 (2000-01-01 00:00:00 UTC)
        estimatedEndTime = Math.floor(Date.now() / 1000) + totalRemaining;
      } else {
        // If no remaining time, set to null (cleaning complete or unknown)
        estimatedEndTime = null;
      }
    } else {
      estimatedEndTime = null;
    }
    try {
      void safeSetAttribute(device, ServiceArea.Cluster.id, 'estimatedEndTime', estimatedEndTime, this.log);
    } catch (error) {
      this.logDevice('debug', entityId, 'STATE', '无法设置 estimatedEndTime:', error);
    }
  }

  updateCountdownTime(device: any, controller: HAVacuumController, progressArray: any[], state: VacuumState, _roomCleaningDuration: Record<string, number>) {
    const entityId = controller.entityId;

    let countdownTime: number | null;
    if (state.state === 'cleaning' || state.state === 'paused') {
      let totalRemaining = 0;
      let hasEstimate = false;
      for (const p of progressArray) {
        if (typeof p?.estimatedTime === 'number') {
          totalRemaining += p.estimatedTime;
          hasEstimate = true;
        }
      }
      if (hasEstimate) {
        countdownTime = totalRemaining > 0 ? totalRemaining : 0;
      } else {
        countdownTime = null;
      }
    } else {
      countdownTime = null;
    }

    try {
      void safeSetAttribute(device, RvcOperationalState.Cluster.id, 'countdownTime', countdownTime, this.log);

      // 记录日志
      if (countdownTime !== null) {
        const minutes = Math.floor(countdownTime / 60);
        const seconds = countdownTime % 60;
        if (minutes > 0) {
          this.logDevice('debug', entityId, 'COUNTDOWN', `剩余时间 → ${minutes}分${seconds}秒 (${countdownTime}秒)`);
        } else {
          this.logDevice('debug', entityId, 'COUNTDOWN', `剩余时间 → ${seconds}秒`);
        }
      } else {
        this.logDevice('debug', entityId, 'COUNTDOWN', `剩余时间 → null（无法估算或已完成）`);
      }
    } catch (error) {
      this.logDevice('debug', entityId, 'COUNTDOWN', '无法更新 countdownTime:', error);
    }
  }

  async onConfigure() {
    this.log.info('⚙️  配置插件');
  }

  async onShutdown(reason?: string) {
    this.log.info(`🛑 关闭插件: ${reason || '未知原因'}`);
    for (const ctrl of this.vacuumControllers.values()) {
      ctrl.destroy();
    }
    await this.haClient?.disconnect();
    this.vacuumControllers.clear();
    this.matterDevices.clear();
    this.log.info('✅ 插件已关闭');
  }
}

/**
 *
 * @param errorMsg
 */
function mapDreameErrorToMatter(errorMsg: string) {
  if (!errorMsg || errorMsg === 'no_error' || errorMsg === 'null' || errorMsg === 'unavailable') {
    return null;
  }
  const lowerError = errorMsg.toLowerCase().replace(/\s+/g, '_');
  const knownErrors: Record<string, { id: number; label: string }> = {
    drop: { id: 0x02, label: '悬崖传感器' },
    bumper: { id: 0x02, label: '碰撞传感器异常' },
    route: { id: 0x02, label: '路径规划失败' },
    mop_removed: { id: 0x03, label: '拖布未安装' },
    clean_mop_pad: { id: 0x03, label: '需要清洁拖布' },
    unknown: { id: 0x02, label: '未知错误' },
  };
  if (knownErrors[lowerError]) {
    return {
      errorStateId: knownErrors[lowerError].id,
      errorStateLabel: knownErrors[lowerError].label,
      errorStateDetails: errorMsg,
    };
  }
  if (lowerError.includes('wheel') || lowerError.includes('brush') || lowerError.includes('stuck') || lowerError.includes('sensor')) {
    return {
      errorStateId: 0x02,
      errorStateLabel: '机械/传感器故障',
      errorStateDetails: errorMsg,
    };
  }
  if (lowerError.includes('dustbin') || lowerError.includes('filter') || lowerError.includes('mop') || lowerError.includes('water')) {
    return {
      errorStateId: 0x03,
      errorStateLabel: '需要维护',
      errorStateDetails: errorMsg,
    };
  }
  if (lowerError.includes('battery') || lowerError.includes('charging')) {
    return {
      errorStateId: 0x01,
      errorStateLabel: '电源问题',
      errorStateDetails: errorMsg,
    };
  }
  return {
    errorStateId: 0x02,
    errorStateLabel: '设备错误',
    errorStateDetails: errorMsg,
  };
}
