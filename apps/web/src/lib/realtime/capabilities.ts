// Capabilities gate UI tools. Party-document writes are separately authorized by
// the party server; game-session permissions retain their existing behavior.

export interface SessionCapabilities {
  canEditScene: boolean;
  canManageScenes: boolean;
  canSwitchScene: boolean;
  canEditFog: boolean;
  canMoveMarkers: boolean;
  canMeasure: boolean;
  canDrawTemporary: boolean;
  canPersistDrawings: boolean;
  emitsCursor: boolean;
}

export const editorCapabilities: SessionCapabilities = {
  canEditScene: true,
  canManageScenes: true,
  canSwitchScene: true,
  canEditFog: true,
  canMoveMarkers: true,
  canMeasure: true,
  canDrawTemporary: true,
  canPersistDrawings: true,
  emitsCursor: true
};

export const playCapabilities = (options: { isTouchDevice: boolean }): SessionCapabilities => ({
  canEditScene: false,
  canManageScenes: false,
  canSwitchScene: options.isTouchDevice,
  canEditFog: options.isTouchDevice,
  canMoveMarkers: true,
  canMeasure: options.isTouchDevice,
  canDrawTemporary: true,
  canPersistDrawings: options.isTouchDevice,
  emitsCursor: false
});
