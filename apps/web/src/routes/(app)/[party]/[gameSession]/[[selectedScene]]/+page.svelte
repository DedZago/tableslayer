<script lang="ts">
  import { useAssetMutation, useTokenArtworkMutation } from '$lib/queries/assets';
  import {
    hasFileDrop,
    hasWebsiteImageDrop,
    singleDroppedImage,
    WEBSITE_IMAGE_DROP_MESSAGE
  } from '$lib/utils/imageDrop';
  import { createClipboardGrantQuery, useTokenPasteMutation } from '$lib/queries/tokenClipboard';
  import {
    clipboardTargetIsEditable,
    createTokenClipboard,
    getClipboardGeometry,
    parseTokenClipboard,
    serializeTokenClipboard,
    tokenPastePositions,
    TOKEN_CLIPBOARD_FORMAT,
    type ClipboardPoint
  } from '$lib/utils/tokenClipboard';
  import {
    ASSET_DRAG_TYPE,
    AssetCatalogOverlay,
    AssetLibrary,
    markerAssetSnapshot,
    placeAsset,
    type PlacementPoint
  } from '$lib/components/Assets';
  import {
    addCombatants,
    beginCombat,
    endCombat,
    InitiativeTracker,
    nextTurn,
    nudgeTie,
    previousTurn,
    recoverActiveTurn,
    removeCombatants,
    rerollAll,
    rollEmpty,
    rollOne,
    setInitiative,
    setInitiativeBonus,
    startCombat,
    type CombatAction
  } from '$lib/components/Combat';
  import AoeTemplateManager from '$lib/components/GameSession/AoeTemplateManager.svelte';
  import SidePanelTabs, { type SidePanelTab } from '$lib/components/GameSession/SidePanelTabs.svelte';
  import TokenContextPanel from '$lib/components/GameSession/TokenContextPanel.svelte';
  import { StatBlockQuickCard, type StatBlockRoll } from '$lib/components/StatBlock';
  import { HandoutLivePill, HandoutPanel, type HandoutPreview } from '$lib/components/Handouts';
  import type { AssetListItem } from '$lib/queries/assets';
  import { goto } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import {
    AnnotationManager,
    Checklist,
    ChecklistHelpButton,
    Head,
    Hints,
    LightManager,
    MarkerManager,
    SceneControls,
    SceneSelector,
    SceneZoom,
    Shortcuts,
    type ChecklistItemId
  } from '$lib/components';
  import {
    useEditorActivityMutation,
    useUpdateChecklistProgressMutation,
    useUploadSceneThumbnailMutation
  } from '$lib/queries';
  import {
    EDITOR_IDLE_POLICY,
    SleepController,
    buildRenderProps,
    reuseUnchanged,
    type AnnotationRow,
    type AoeTemplateRow,
    type MarkerRow
  } from '$lib/realtime';
  import { isSameTurn, readTurnPosition, sameCombatantView, type TurnPosition } from '$lib/utils/initiative';
  import {
    bindPropertyUpdatesToDoc,
    buildSceneProps,
    convertMarkerToDbFormat,
    extractLocationFromUrl,
    flushQueuedPropertyUpdates,
    handleKeyCommands,
    handleStageZoom,
    queuePropertyUpdate,
    relockMapZoom,
    setChecklistContext,
    unbindPropertyUpdates
  } from '$lib/utils';
  import { getPreference, setPreference, type PaneConfig } from '$lib/utils/gameSessionPreferences';
  import { stagePerformance } from '$lib/stores';
  import { getLatestMeasurement } from '$lib/utils/measurements';
  import { throttle } from '$lib/utils/throttle';
  import { conditionPickerState, stepConditionValue } from '$lib/utils/markerConditionPicker';
  import {
    AnnotationEffect,
    AoeShape,
    type AoeTemplate,
    type AoeToolSettings,
    DrawingSliders,
    GridMode,
    MapLayerType,
    MarkerVisibility,
    PerformanceDebugger,
    PointerInputManager,
    rotateTemplateAngle,
    Stage,
    StageMode,
    ToolType,
    type AnnotationLayerData,
    sortConditions,
    type HoveredMarker,
    type Light,
    type Marker,
    type MarkerCondition,
    type StageExports,
    type StageProps
  } from '@tableslayer/stage';
  import { addToast, FogSliders, Icon, removeToast } from '@tableslayer/ui';
  import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp } from '@tabler/icons-svelte';
  import { Pane, PaneGroup, PaneResizer, type PaneAPI } from 'paneforge';
  import { onMount, untrack, type ComponentProps } from 'svelte';
  import { EditorSession } from './useEditorSession.svelte';

  let { data } = $props();
  const { gameSession, party, user, isStripeEnabled, checklistState } = $derived(data);

  const selectedSceneId = $derived(page.params.selectedScene ?? data.selectedScene.id);

  // ---------------------------------------------------------------------------
  // Realtime session (connection identity captured once at mount)
  // ---------------------------------------------------------------------------

  const createThumbnailMutation = useUploadSceneThumbnailMutation();
  const updateChecklistMutation = useUpdateChecklistProgressMutation();

  const session = untrack(
    () =>
      new EditorSession({
        partyId: data.party.id,
        gameSessionId: data.gameSession.id,
        userId: data.user.id,
        partykitHost: data.partykitHost,
        selectedSceneId: () => selectedSceneId,
        getStage: () => stage,
        uploadThumbnail: async (blob, sceneId, currentUrl) => {
          try {
            return await createThumbnailMutation.mutateAsync({ blob, sceneId, currentUrl });
          } catch {
            return null; // thumbnails are best-effort
          }
        }
      })
  );

  // Idle sleep: a tab hidden for 5 min or untouched for an hour drops its room
  // connections (Durable Objects bill while any socket is open). Input wakes it.
  // While active, a ping every couple of minutes lets a sleeping playfield know
  // the GM is here. Never sleeps mid-gesture.
  const editorActivityMutation = useEditorActivityMutation();
  let reconnectToastId: string | null = null;
  const sleep = untrack(
    () =>
      new SleepController({
        policy: EDITOR_IDLE_POLICY,
        canSleep: () =>
          !stage?.fogOfWar?.isDrawing() && !stage?.annotations?.isDrawing() && Object.keys(dragPositions).length === 0,
        onSleep: () =>
          addToast({
            data: {
              title: 'Live connection paused',
              body: 'Move the mouse or press a key to reconnect',
              type: 'info'
            }
          }),
        onWake: () => {
          reconnectToastId = addToast({ data: { title: 'Reconnecting', type: 'loading' } });
        },
        onPing: () => editorActivityMutation.mutate({ partyId: data.party.id, gameSessionId: data.gameSession.id })
      })
  );

  // Panel property updates write through to the selected scene's doc subtree
  $effect(() => {
    if (session.client && selectedSceneId) {
      bindPropertyUpdatesToDoc(session.client, selectedSceneId);
    }
  });

  // Undo history follows the selected scene; switching scenes clears it
  $effect(() => {
    if (session.ready && session.client && selectedSceneId) {
      session.client.setUndoScope(selectedSceneId);
    }
  });

  const scenes = $derived(session.ready && session.client ? session.client.scenes() : data.scenes);
  const partyState = $derived(
    session.ready && session.client
      ? session.client.partyState()
      : { activeSceneId: data.activeScene?.id ?? null, isPaused: data.party.gameSessionIsPaused }
  );
  const activeSceneId = $derived(partyState.activeSceneId ?? undefined);
  const canEditAssets = $derived(
    data.members.some((member) => member.id === data.user.id && ['admin', 'editor'].includes(member.partyRole))
  );
  const canPresentHandouts = $derived(canEditAssets);
  const liveHandout = $derived(session.client?.ready ? (session.client.partyState().activeHandout ?? null) : null);
  let sidePanelTab = $state<SidePanelTab>('tokens');
  let handoutPreview = $state<HandoutPreview | null>(null);
  const openSidePanelTab = (tab: SidePanelTab) => {
    sidePanelTab = tab;
    if (isMarkersCollapsed) markersPane?.expand();
  };
  const previewAssetHandout = (asset: AssetListItem) => {
    const artworkLocation = asset.artworkLocation || asset.tokenArtworkLocation;
    if (!artworkLocation) return;
    handoutPreview = {
      source: { type: 'asset', id: asset.id, artwork: 'portrait' },
      artworkLocation,
      title: asset.name
    };
    openSidePanelTab('handout');
  };
  const previewTokenHandout = (markerId: string) => {
    const marker = session.client?.scene(selectedSceneId)?.markers.find((marker) => marker.id === markerId);
    if (!marker?.imageLocation) return;
    handoutPreview = {
      source: { type: 'marker', sceneId: selectedSceneId, markerId, location: marker.imageLocation },
      artworkLocation: marker.imageLocation,
      title: marker.title
    };
    openSidePanelTab('handout');
  };
  const saveTokenToLibrary = async (markerId: string) => {
    const row = markerRowFor(markerId);
    if (!row) return;
    try {
      await assetMutation.mutateAsync({
        action: 'saveMarker',
        sceneId: selectedSceneId,
        markerId,
        snapshot: markerAssetSnapshot(row)
      });
      addToast({ data: { title: 'Saved to library', type: 'success' } });
    } catch (error) {
      addToast({
        data: {
          title: 'Could not save to library',
          body: error instanceof Error ? error.message : 'Save failed',
          type: 'danger'
        }
      });
    }
  };
  const currentParty = $derived({ ...party, gameSessionIsPaused: partyState.isPaused });

  // "Connected" now means "your edits are durable" — the server persists doc
  // changes. Toast only the transitions worth telling the user about: a drop
  // after being live, and the subsequent recovery. First connect is silent.
  // "Live" requires both rooms synced, so "Reconnected" means fresh state, not
  // just an open socket. A deliberate idle sleep is not a fault: `sleeping`
  // flips synchronously before the status changes, so the effect can tell.
  const connectionLive = $derived(
    session.client?.status.gameSession === 'connected' &&
      session.client?.status.party === 'connected' &&
      session.client?.synced === true
  );
  let wasLive = false;
  $effect(() => {
    const live = session.ready && connectionLive;
    const sleeping = session.client?.sleeping ?? false;
    if (wasLive && !live) {
      if (!sleeping) {
        addToast({ data: { title: 'Connection lost — edits will sync when back online', type: 'danger' } });
      }
    } else if (!wasLive && live && wasEverLive) {
      if (reconnectToastId) {
        removeToast(reconnectToastId);
        reconnectToastId = null;
      }
      addToast({ data: { title: 'Reconnected', type: 'success' } });
    }
    if (live) wasEverLive = true;
    wasLive = live;
  });
  let wasEverLive = false;

  // Doc settings stand in for the SelectScene row that the control panels expect
  const selectedSceneForControls = $derived.by(() => {
    const snapshot = session.ready && session.client ? session.client.scene(selectedSceneId) : null;
    return snapshot ? (snapshot.settings as unknown as typeof data.selectedScene) : data.selectedScene;
  });

  // If the selected scene disappears (deleted by another editor), fall back
  $effect(() => {
    if (!session.ready || scenes.length === 0 || navigating.to) return;
    if (!scenes.some((scene) => scene.id === selectedSceneId)) {
      goto(`/${page.params.party}/${page.params.gameSession}/${scenes[0].id}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Stage props: doc snapshot + local view -> StageProps
  // Children mutate stageProps for instant feedback; shared values write through
  // to the doc (queuePropertyUpdate / direct writes) and the rebuild below keeps
  // stageProps identical to the doc. Local-only view state is carried over.
  // ---------------------------------------------------------------------------

  // Brush sizes are in grid units (number of grid squares the brush spans).
  // Fog uses whole squares; annotations use quarter steps up to one square,
  // then whole squares (must match BRUSH_SIZES in DrawingSliders).
  const ANNOTATION_BRUSH_SIZES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5];
  const clampFogBrush = (value: number) => Math.max(1, Math.min(5, Math.round(value)));
  const snapAnnotationBrush = (value: number) =>
    ANNOTATION_BRUSH_SIZES.reduce((best, size) => (Math.abs(size - value) < Math.abs(best - value) ? size : best));

  // SSR strips masks from annotation rows (serialization) and ships them as a
  // separate record; merge them back so the seed props paint layers immediately
  const ssrAnnotations = () =>
    data.selectedSceneAnnotations.map((annotation) => ({
      ...annotation,
      mask: data.selectedSceneAnnotationMasks?.[annotation.id] ?? null
    }));

  const initialStageProps = untrack(() => {
    const props = buildSceneProps(
      data.selectedScene,
      data.selectedSceneMarkers,
      'editor',
      ssrAnnotations(),
      data.selectedSceneLights,
      data.bucketUrl,
      []
    );
    props.fogOfWar.tool.size = clampFogBrush(getPreference('brushSizeGridUnits') || 2);
    props.annotations.lineWidth = snapAnnotationBrush(getPreference('annotationLineWidthGridUnits') || 0.5);
    props.annotations.smoothingEnabled = getPreference('annotationSmoothing') ?? true;
    props.marker.snapToGrid = getPreference('markerSnapToGrid') ?? true;
    props.light.snapToGrid = getPreference('lightSnapToGrid') ?? false;
    props.performanceTier = stagePerformance.effectiveTier;
    props.display.maxPixelRatio = stagePerformance.maxPixelRatio;
    if (props.aoeTemplates) props.aoeTemplates.tool = { ...props.aoeTemplates.tool, ...getPreference('aoeTool') };
    return props;
  });

  let stageProps: StageProps = $state(initialStageProps);
  let dragPositions = $state<Record<string, { x: number; y: number }>>({});
  let lastBuiltSceneId: string | undefined = untrack(() => data.selectedScene.id);

  $effect(() => {
    const snapshot = session.ready && session.client ? session.client.scene(selectedSceneId) : null;
    const drags = dragPositions;
    const ssrScene = data.selectedScene;

    if (!snapshot) {
      // Realtime not ready (or scene missing from the doc): scene navigation must
      // still work from SSR data — degraded mode, not a frozen editor.
      if (ssrScene.id === selectedSceneId && ssrScene.id !== lastBuiltSceneId) {
        lastBuiltSceneId = ssrScene.id;
        untrack(() => {
          const props = buildSceneProps(
            ssrScene,
            data.selectedSceneMarkers,
            'editor',
            ssrAnnotations(),
            data.selectedSceneLights,
            data.bucketUrl,
            []
          );
          props.fogOfWar.tool.size = clampFogBrush(getPreference('brushSizeGridUnits') || 2);
          props.annotations.lineWidth = snapAnnotationBrush(getPreference('annotationLineWidthGridUnits') || 0.5);
          props.annotations.smoothingEnabled = getPreference('annotationSmoothing') ?? true;
          props.marker.snapToGrid = getPreference('markerSnapToGrid') ?? true;
          props.light.snapToGrid = getPreference('lightSnapToGrid') ?? false;
          props.performanceTier = stagePerformance.effectiveTier;
          props.display.maxPixelRatio = stagePerformance.maxPixelRatio;
          stageProps = props;
          activeControl = 'none';
          selectedMarkerId = undefined;
          selectedLightId = undefined;
          selectedAnnotationId = undefined;
          sceneMasksApplied = false;
        });
      }
      return;
    }

    const isSceneSwitch = snapshot.id !== lastBuiltSceneId;
    lastBuiltSceneId = snapshot.id;

    untrack(() => {
      const prev = stageProps;
      const next = buildRenderProps(
        snapshot,
        {
          mode: 'editor',
          activeLayer: isSceneSwitch ? MapLayerType.None : prev.activeLayer,
          viewport: isSceneSwitch
            ? {
                offset: { x: snapshot.settings.sceneOffsetX, y: snapshot.settings.sceneOffsetY },
                rotation: snapshot.settings.sceneRotation,
                zoom: 1,
                autoFit: true
              }
            : {
                offset: prev.scene.offset,
                zoom: prev.scene.zoom,
                rotation: prev.scene.rotation,
                autoFit: prev.scene.autoFit
              },
          markerPositions: drags,
          fogTool: isSceneSwitch
            ? { size: clampFogBrush(getPreference('brushSizeGridUnits') || 2) }
            : { type: prev.fogOfWar.tool.type, size: prev.fogOfWar.tool.size, mode: prev.fogOfWar.tool.mode },
          annotations: isSceneSwitch
            ? {
                activeLayer: null,
                lineWidth: snapAnnotationBrush(getPreference('annotationLineWidthGridUnits') || 0.5),
                smoothingEnabled: getPreference('annotationSmoothing') ?? true
              }
            : {
                activeLayer: prev.annotations.activeLayer,
                lineWidth: prev.annotations.lineWidth,
                smoothingEnabled: prev.annotations.smoothingEnabled
              },
          marker: isSceneSwitch
            ? { snapToGrid: getPreference('markerSnapToGrid') ?? true }
            : { snapToGrid: prev.marker.snapToGrid },
          light: isSceneSwitch
            ? { snapToGrid: getPreference('lightSnapToGrid') ?? false }
            : { snapToGrid: prev.light.snapToGrid },
          measurement: isSceneSwitch
            ? undefined
            : {
                type: prev.measurement.type,
                coneAngle: prev.measurement.coneAngle,
                beamWidth: prev.measurement.beamWidth
              },
          aoeTemplates: {
            tool: prev.aoeTemplates?.tool,
            selectedId: isSceneSwitch ? null : prev.aoeTemplates?.selectedId,
            showLabels: prev.aoeTemplates?.showLabels
          }
        },
        data.bucketUrl
      );
      next.performanceTier = stagePerformance.effectiveTier;
      next.display.maxPixelRatio = stagePerformance.maxPixelRatio;
      // Structural sharing: unchanged subtrees keep their identity so stage-internal
      // effects (measurement reset, material/texture updates) don't re-fire
      stageProps = reuseUnchanged(prev, next);

      if (isSceneSwitch) {
        activeControl = 'none';
        selectedMarkerId = undefined;
        selectedLightId = undefined;
        selectedAnnotationId = undefined;
        sceneMasksApplied = false;
      }
    });
  });

  // Apply performance tier changes (watchdog step-downs or manual selection)
  // between prop rebuilds; rebuilds pick the tier up at build time
  $effect(() => {
    const tier = stagePerformance.effectiveTier;
    const maxPixelRatio = stagePerformance.maxPixelRatio;
    untrack(() => {
      if (stageProps.performanceTier !== tier) {
        stageProps.performanceTier = tier;
        stageProps.display = { ...stageProps.display, maxPixelRatio };
      }
    });
  });

  // Broadcast the performance setting so connected playfields mirror it
  $effect(() => {
    const setting = stagePerformance.setting;
    session.presence?.updateStagePerformance(setting);
  });

  // Apply doc masks when the displayed scene changes (and once the stage exists)
  let sceneMasksApplied = $state(false);
  $effect(() => {
    if (stageIsLoading || sceneMasksApplied || !session.ready) return;
    if (lastBuiltSceneId !== selectedSceneId) return;
    sceneMasksApplied = true;
    session.applyMasks(selectedSceneId);
  });

  // The map-defined zoom is derived, not user-set: one grid cell = grid
  // spacing inches on the TV. Control handlers re-lock it synchronously for
  // atomic writes; this effect is the safety net for everything else (map
  // replacement with different pixel dimensions, remote editors changing the
  // grid count or display). relockMapZoom reads the grid/display/rotation
  // inputs, so they become this effect's dependencies; idempotent writes
  // converge without ping-pong.
  $effect(() => {
    if (stageIsLoading || !session.ready) return;
    if (lastBuiltSceneId !== selectedSceneId) return;
    relockMapZoom(stageProps, stage);
  });

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------

  let stage: StageExports = $state(null)!;
  const tokenArtwork = useTokenArtworkMutation();
  let artworkDropTargetId = $state<string | null>(null);
  let artworkIsUploading = $state(false);

  const replaceTokenArtwork = async (file: File, markerId: string) => {
    if (artworkIsUploading) throw new Error('Wait for the current image upload to finish');
    const destinationClient = session.client;
    const destinationSceneId = selectedSceneId;
    if (!destinationClient?.scene(destinationSceneId)?.markers.some((marker) => marker.id === markerId)) {
      throw new Error('The target token no longer exists');
    }
    artworkIsUploading = true;
    try {
      const uploaded = await tokenArtwork.mutateAsync({ file, sceneId: destinationSceneId });
      destinationClient.stopCapturing();
      const updated = destinationClient.write.setExistingMarkerFields(destinationSceneId, markerId, {
        imageLocation: uploaded.location
      });
      destinationClient.stopCapturing();
      addToast({
        data: {
          title: updated ? 'Token image updated' : 'The target token was deleted; image was not applied',
          type: updated ? 'success' : 'info'
        }
      });
    } finally {
      artworkIsUploading = false;
      artworkDropTargetId = null;
    }
  };

  // Asset library tiles drag onto the map as copies (see assetPlacement.ts)
  const assetMutation = useAssetMutation();
  let libraryQuantity = $state(1);
  let catalogOpen = $state(false);
  const isAssetDrag = (dataTransfer: DataTransfer | null) => !!dataTransfer?.types.includes(ASSET_DRAG_TYPE);
  const getViewportCenter = (): PlacementPoint | null => stage?.markers.viewportCenter() ?? null;
  const placeAssetAt = (assetId: string, quantity: number, at: PlacementPoint) =>
    placeAsset({
      assetId,
      quantity,
      at,
      sceneId: selectedSceneId,
      client: session.client,
      mutate: (action) => assetMutation.mutateAsync(action),
      snap: snapPlacement
    });
  const snapPlacement = (point: PlacementPoint) => stage?.markers.snapPosition(point) ?? point;

  const handleCanvasDragOver = (event: DragEvent) => {
    if (isAssetDrag(event.dataTransfer)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (!hasFileDrop(event.dataTransfer) && !hasWebsiteImageDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    artworkDropTargetId = !artworkIsUploading
      ? (stage?.markers.hitTest({ x: event.clientX, y: event.clientY }) ?? null)
      : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = artworkDropTargetId ? 'copy' : 'none';
  };

  const handleCanvasDrop = async (event: DragEvent) => {
    if (isAssetDrag(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
      const assetId = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
      const at = stage?.markers.clientToPosition({ x: event.clientX, y: event.clientY }, true);
      if (!assetId) return;
      if (!at) {
        addToast({ data: { title: 'Drop inside the map', type: 'info' } });
        return;
      }
      void placeAssetAt(assetId, libraryQuantity, at);
      return;
    }
    if (!hasFileDrop(event.dataTransfer) && !hasWebsiteImageDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    artworkDropTargetId = null;
    if (!hasFileDrop(event.dataTransfer)) {
      addToast({ data: { title: WEBSITE_IMAGE_DROP_MESSAGE, type: 'info' } });
      return;
    }
    try {
      const file = singleDroppedImage(event.dataTransfer!.files);
      const markerId = stage?.markers.hitTest({ x: event.clientX, y: event.clientY });
      if (!markerId) {
        addToast({
          data: { title: 'Drop an image on a token, or in the scene sidebar to create a scene', type: 'info' }
        });
        return;
      }
      await replaceTokenArtwork(file, markerId);
    } catch (error) {
      addToast({
        data: {
          title: 'Error uploading image',
          body: error instanceof Error ? error.message : 'Image upload failed',
          type: 'danger'
        }
      });
    }
  };

  let stageElement: HTMLDivElement | undefined = $state();
  let stageIsLoading = $state(true);
  let isCursorInScene = $state(false);
  let activeControl = $state('none');
  let selectedMarkerId: string | undefined = $state();
  let selectedMarkerIds: string[] = $state([]);
  let selectionRectangle: { x: number; y: number; width: number; height: number } | null = $state(null);
  let statBlockQuickCardCollapsed = $state(getPreference('statBlockQuickCardCollapsed') ?? false);

  // Identity-preserving: the stage re-renders selection only when the ids actually change
  const setSelection = (ids: string[]) => {
    if (ids.length === selectedMarkerIds.length && ids.every((id, i) => id === selectedMarkerIds[i])) return;
    selectedMarkerIds = ids;
  };

  $effect(() => {
    const sceneId = selectedSceneId;
    untrack(() => {
      setSelection([]);
      selectionRectangle = null;
      artworkDropTargetId = null;
    });
  });

  $effect(() => {
    if (selectedMarkerIds.length === 0) return;
    const available = new Set(
      stageProps.marker.markers
        .filter((marker) => marker.visibility !== MarkerVisibility.Player)
        .map((marker) => marker.id)
    );
    untrack(() => {
      setSelection(selectedMarkerIds.filter((id) => available.has(id)));
    });
  });
  const selectedCopyRows = $derived.by(() => {
    const rows = session.client?.scene(selectedSceneId)?.markers ?? [];
    return rows
      .filter((row) => selectedMarkerIds.includes(row.id))
      .map((row) => {
        const marker = stageProps.marker.markers.find((marker) => marker.id === row.id);
        return marker
          ? {
              ...row,
              title: marker.title,
              label: marker.label,
              shape: marker.shape,
              shapeColor: marker.shapeColor,
              size: marker.size,
              imageScale: marker.imageScale,
              visibility: marker.visibility,
              note: marker.note,
              positionX: marker.position.x,
              positionY: marker.position.y
            }
          : row;
      });
  });
  const clipboardLocations = $derived(
    [...new Set(selectedCopyRows.flatMap((row) => (row.imageLocation ? [row.imageLocation] : [])))].sort()
  );
  const clipboardGrant = createClipboardGrantQuery(
    () => selectedSceneId,
    () => clipboardLocations,
    () => selectedCopyRows.length > 0 && selectedCopyRows.length <= 100
  );
  const tokenPaste = useTokenPasteMutation();
  let clipboardPointer: { sceneId: string; point: ClipboardPoint } | null = null;
  let pasteHistory: { text: string; sceneId: string; point: ClipboardPoint; count: number } | null = null;
  let pastePending = false;

  const clipboardError = (title: string, error: unknown) =>
    addToast({
      data: {
        title,
        body:
          error instanceof Error
            ? error.message
            : (error as { message?: string })?.message || 'Token clipboard action failed',
        type: 'danger'
      }
    });

  const handleTokenCopy = (event: ClipboardEvent) => {
    if (
      clipboardTargetIsEditable(event.target) ||
      !selectedCopyRows.length ||
      !event.clipboardData ||
      window.getSelection()?.toString()
    )
      return;
    event.preventDefault();
    try {
      if (stageIsLoading) throw new Error('Wait for the scene to finish loading');
      if (!clipboardGrant.data) {
        void clipboardGrant.refetch();
        throw new Error('Artwork authorization is preparing; try copying again in a moment');
      }
      flushQueuedPropertyUpdates();
      const clipboard = createTokenClipboard(
        selectedCopyRows,
        getClipboardGeometry(stageProps, stage.map.getSize()),
        clipboardGrant.data
      );
      event.clipboardData.setData('text/plain', serializeTokenClipboard(clipboard));
      addToast({ data: { title: `${clipboard.tokens.length} tokens copied`, type: 'success' } });
    } catch (error) {
      clipboardError('Copy failed', error);
    }
  };

  const pasteTokens = async (text: string) => {
    if (pastePending) return;
    pastePending = true;
    const destination = selectedSceneId;
    const destinationClient = session.client;
    try {
      if (stageIsLoading || !destinationClient?.scene(destination))
        throw new Error('Wait for the scene to finish loading');
      const clipboard = parseTokenClipboard(text);
      const point = clipboardPointer?.sceneId === destination ? clipboardPointer.point : stage.markers.viewportCenter();
      if (!point) throw new Error('Could not determine the paste position');
      const count =
        pasteHistory?.text === text &&
        pasteHistory.sceneId === destination &&
        pasteHistory.point.x === point.x &&
        pasteHistory.point.y === point.y
          ? pasteHistory.count
          : 0;
      const positions = tokenPastePositions(
        clipboard,
        getClipboardGeometry(stageProps, stage.map.getSize()),
        point,
        (position) => stage.markers.snapPosition(position),
        count
      );
      const result = await tokenPaste.mutateAsync({ action: 'paste', sceneId: destination, clipboard, positions });
      if (
        selectedSceneId !== destination ||
        session.client !== destinationClient ||
        !destinationClient.scene(destination)
      ) {
        throw new Error('Paste cancelled because the destination scene changed');
      }
      destinationClient.stopCapturing();
      destinationClient.write.transaction(() =>
        result.markers.forEach((marker) => destinationClient.write.upsertMarker(destination, marker))
      );
      destinationClient.stopCapturing();
      setSelection(result.markers.map((marker) => marker.id));
      markersPane.expand();
      pasteHistory = { text, sceneId: destination, point: { ...point }, count: count + 1 };
    } catch (error) {
      clipboardError('Paste failed', error);
    } finally {
      pastePending = false;
    }
  };

  const handleTokenPaste = (event: ClipboardEvent) => {
    if (clipboardTargetIsEditable(event.target)) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes(TOKEN_CLIPBOARD_FORMAT)) return;
    event.preventDefault();
    void pasteTokens(text);
  };

  let selectedLightId: string | undefined = $state();
  let selectedAnnotationId: string | undefined = $state();
  let innerWidth: number = $state(1000);
  let hoveredMarker: HoveredMarker | null = $state(null);

  const isMobile = $derived(innerWidth < 768);
  const minZoom = 0.1;
  const maxZoom = 10;
  const zoomSensitivity = 0.0005;

  let pinnedCache: string[] = [];
  const pinnedMarkerIds = $derived.by(() => {
    const next = stageProps.marker.markers.filter((m) => m.pinnedTooltip).map((m) => m.id);
    if (next.length === pinnedCache.length && next.every((id, i) => id === pinnedCache[i])) return pinnedCache;
    pinnedCache = next;
    return next;
  });
  const activeAnnotation = $derived(
    stageProps?.annotations.layers.find((layer) => layer.id === stageProps.annotations.activeLayer)
  );
  const isHoveringMarker = $derived(stage?.markers?.isHoveringMarker ?? false);
  const isDraggingMarker = $derived(stage?.markers?.isDraggingMarker ?? false);

  const stageClasses = $derived(
    [
      'stage',
      (stageIsLoading || navigating.to) && 'stage--loading',
      isCursorInScene && isDraggingMarker && 'stage--grabbingCursor',
      isCursorInScene && !isDraggingMarker && isHoveringMarker && 'stage--pointerCursor',
      isCursorInScene &&
        !isHoveringMarker &&
        !isDraggingMarker &&
        (stageProps.activeLayer === MapLayerType.Annotation ||
          (stageProps.activeLayer === MapLayerType.FogOfWar && stageProps.fogOfWar.tool.type === ToolType.Brush)) &&
        'stage--hideCursor',
      isCursorInScene &&
        !isHoveringMarker &&
        !isDraggingMarker &&
        stageProps.activeLayer === MapLayerType.FogOfWar &&
        (stageProps.fogOfWar.tool.type === ToolType.Rectangle || stageProps.fogOfWar.tool.type === ToolType.Ellipse) &&
        'stage--crosshairCursor'
    ].filter(Boolean)
  );

  // Measurements received from other clients (playfield -> editor)
  const measurements = $derived(session.presence?.measurements ?? {});
  const latestMeasurement = $derived(getLatestMeasurement(measurements));

  // ---------------------------------------------------------------------------
  // Checklist
  // ---------------------------------------------------------------------------

  let checklistCompletedItems = $state<string[]>(untrack(() => checklistState?.completedItems ?? []));
  let checklistDismissed = $state(untrack(() => checklistState?.isDismissed ?? false));
  let forceShowChecklist = $state(false);
  const panelRequiringControls = ['annotation', 'light', 'marker', 'aoe'];
  const showChecklist = $derived(
    !panelRequiringControls.includes(activeControl) &&
      !selectedMarkerId &&
      (forceShowChecklist || (checklistState?.isEligibleForAutoShow && !checklistDismissed))
  );

  const trackChecklistItemLocal = (itemId: string) => {
    if (!checklistCompletedItems.includes(itemId)) {
      checklistCompletedItems = [...checklistCompletedItems, itemId];
      updateChecklistMutation.mutate({ completedItems: checklistCompletedItems, dismissed: checklistDismissed });
    }
  };

  setChecklistContext({
    trackItem: trackChecklistItemLocal,
    isItemCompleted: (itemId) => checklistCompletedItems.includes(itemId)
  });

  const handleChecklistItemComplete = (itemId: ChecklistItemId) => {
    checklistCompletedItems = checklistCompletedItems.includes(itemId)
      ? checklistCompletedItems.filter((id) => id !== itemId)
      : [...checklistCompletedItems, itemId];
    updateChecklistMutation.mutate({ completedItems: checklistCompletedItems, dismissed: checklistDismissed });
  };

  const handleChecklistDismiss = () => {
    checklistDismissed = true;
    forceShowChecklist = false;
    updateChecklistMutation.mutate({ completedItems: checklistCompletedItems, dismissed: true });
  };

  const handleShowChecklist = () => {
    forceShowChecklist = true;
    sidePanelTab = 'tokens';
    activeControl = 'none';
    selectedMarkerId = undefined;
    queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.None, 'control');
    if (isMarkersCollapsed) {
      markersPane.expand();
    }
  };

  // ---------------------------------------------------------------------------
  // Pane layout
  // ---------------------------------------------------------------------------

  let scenesPane: PaneAPI = $state(undefined)!;
  let markersPane: PaneAPI = $state(undefined)!;
  let lightsPane: PaneAPI = $state(undefined)!;
  let isScenesCollapsed = $state(false);
  let isMarkersCollapsed = $state(true);

  const getInitialLayout = (key: 'paneLayoutDesktop' | 'paneLayoutMobile', serverValue: PaneConfig[] | undefined) => {
    if (typeof window !== 'undefined') {
      const saved = getPreference(key);
      if (saved) return saved;
    }
    return (
      serverValue ||
      (key === 'paneLayoutDesktop'
        ? [{ size: 20, isCollapsed: false }, { size: 50 }, { size: 30, isCollapsed: true }]
        : [{ size: 25, isCollapsed: false }, { size: 50 }, { size: 25, isCollapsed: true }])
    );
  };

  let clientPaneLayoutDesktop = $state<PaneConfig[]>(
    untrack(() => getInitialLayout('paneLayoutDesktop', data.paneLayoutDesktop))
  );
  let clientPaneLayoutMobile = $state<PaneConfig[]>(
    untrack(() => getInitialLayout('paneLayoutMobile', data.paneLayoutMobile))
  );
  const paneLayout = $derived(isMobile ? clientPaneLayoutMobile : clientPaneLayoutDesktop);

  $effect(() => {
    if (paneLayout && Array.isArray(paneLayout)) {
      isScenesCollapsed = paneLayout[0]?.isCollapsed ?? false;
      isMarkersCollapsed = paneLayout[2]?.isCollapsed ?? true;
    }
  });

  const startPaneMinSize = $derived(isMobile ? 10 : Math.min(50, Math.ceil((250 / innerWidth) * 100)));
  const endPaneMinSize = $derived(isMobile ? 10 : Math.min(50, Math.ceil((300 / innerWidth) * 100)));

  const onLayoutChange = (sizes: number[]) => {
    const roundedSizes = sizes.map((size) => Math.round(size));
    const newLayout: PaneConfig[] = [
      { size: roundedSizes[0], isCollapsed: isScenesCollapsed },
      { size: roundedSizes[1] },
      { size: roundedSizes[2], isCollapsed: isMarkersCollapsed }
    ];
    if (isMobile) {
      setPreference('paneLayoutMobile', newLayout);
      clientPaneLayoutMobile = newLayout;
    } else {
      setPreference('paneLayoutDesktop', newLayout);
      clientPaneLayoutDesktop = newLayout;
    }
  };

  const saveCollapseState = () => {
    if (!paneLayout || !Array.isArray(paneLayout)) return;
    onLayoutChange(paneLayout.map((p) => p.size));
  };

  const handleToggleScenes = () => (isScenesCollapsed ? scenesPane.expand() : scenesPane.collapse());
  const handleToggleMarkers = () => (isMarkersCollapsed ? markersPane.expand() : markersPane.collapse());
  const handleToggleAnnotationPanel = () => {
    if (isMarkersCollapsed) {
      markersPane.expand();
      if (activeControl !== 'annotation') activeControl = 'annotation';
    } else {
      markersPane.collapse();
    }
  };

  const getCollapseIcon = () => {
    if (isMobile) return isScenesCollapsed ? IconChevronDown : IconChevronUp;
    return isScenesCollapsed ? IconChevronRight : IconChevronLeft;
  };
  const getMarkerCollapseIcon = () => {
    if (isMobile) return isMarkersCollapsed ? IconChevronUp : IconChevronDown;
    return isMarkersCollapsed ? IconChevronLeft : IconChevronRight;
  };

  // ---------------------------------------------------------------------------
  // Tool selection
  // ---------------------------------------------------------------------------

  const handleSelectActiveControl = (control: string, opts: { toggle?: boolean } = {}): void => {
    if (control === activeControl && opts.toggle === false) return;

    if (activeControl === 'light') selectedLightId = undefined;

    if (control === activeControl) {
      activeControl = 'none';
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.None, 'control');
      if (control === 'annotation') {
        queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
      }
      return;
    }

    activeControl = control;
    if (['annotation', 'light', 'marker', 'aoe'].includes(control)) {
      forceShowChecklist = false;
      sidePanelTab = 'tokens';
    }

    if (control === 'marker') {
      selectedMarkerId = undefined;
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.Marker, 'control');
      queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
      markersPane?.expand();
    } else if (control === 'light') {
      selectedLightId = undefined;
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.Light, 'control');
      queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
      lightsPane?.expand();
    } else if (control === 'annotation') {
      selectedAnnotationId = undefined;
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.Annotation, 'control');
    } else if (control === 'aoe') {
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.AoeTemplate, 'control');
      queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
      markersPane?.expand();
    } else if (control === 'measurement') {
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.Measurement, 'control');
      queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
      trackChecklistItemLocal('measurement');
    } else if (control === 'erase') {
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.FogOfWar, 'control');
      queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
    } else {
      queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.None, 'control');
      queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
    }
  };

  // Auto-manage annotation layer activation (create-on-first-use)
  let lastActiveLayer = $state<MapLayerType | null>(null);
  let lastActiveAnnotationLayer = $state<string | null>(null);
  $effect(() => {
    const activeLayerValue = stageProps.activeLayer;
    const activeAnnotationLayer = stageProps.annotations.activeLayer;
    if (activeLayerValue === lastActiveLayer && activeAnnotationLayer === lastActiveAnnotationLayer) return;
    lastActiveLayer = activeLayerValue;
    lastActiveAnnotationLayer = activeAnnotationLayer;

    untrack(() => {
      if (activeLayerValue === MapLayerType.Annotation) {
        if (activeControl !== 'annotation') activeControl = 'annotation';
        if (!activeAnnotationLayer) {
          if (stageProps.annotations.layers.length === 0) {
            onAnnotationCreated();
          } else {
            queuePropertyUpdate(
              stageProps,
              ['annotations', 'activeLayer'],
              stageProps.annotations.layers[0].id,
              'control'
            );
          }
        }
      } else if (activeAnnotationLayer) {
        queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], null, 'control');
      }
    });
  });

  $effect(() => {
    if (stageProps.activeLayer === MapLayerType.Marker && activeControl !== 'marker') {
      activeControl = 'marker';
      markersPane.expand();
    }
  });

  // MeasurementControls writes activeLayer directly; keep the toolbar highlight in sync
  $effect(() => {
    if (stageProps.activeLayer === MapLayerType.Measurement && activeControl !== 'measurement') {
      activeControl = 'measurement';
    }
  });

  // ---------------------------------------------------------------------------
  // Stage callbacks: every shared edit writes the doc; nothing here saves to the DB
  // ---------------------------------------------------------------------------

  const handleSceneFit = () => {
    stageProps.scene.autoFit = true;
    stage.scene.fit();
  };
  const handleMapFill = () => stage.map.fit();
  const handleMapFit = () => stage.map.fit();

  const onMapUpdate = (offset: { x: number; y: number }, zoom: number) => {
    queuePropertyUpdate(stageProps, ['map', 'offset', 'x'], offset.x, 'control');
    queuePropertyUpdate(stageProps, ['map', 'offset', 'y'], offset.y, 'control');
    queuePropertyUpdate(stageProps, ['map', 'zoom'], zoom, 'control');
  };

  const onSceneUpdate = (offset: { x: number; y: number }, zoom: number) => {
    stageProps.scene.offset.x = offset.x;
    stageProps.scene.offset.y = offset.y;
    stageProps.scene.zoom = zoom;
  };

  const onStageLoading = () => {
    stageIsLoading = true;
  };

  const onStageInitialized = async () => {
    stageIsLoading = false;

    // SSR fog mask gives a fast first paint; the doc re-applies once ready.
    // (Annotation masks are declarative layer props — no application needed.)
    if (data.selectedSceneFogMask && stage?.fogOfWar?.fromRLE) {
      try {
        const bytes = Uint8Array.from(atob(data.selectedSceneFogMask), (c) => c.charCodeAt(0));
        await stage.fogOfWar.fromRLE(bytes, 1024, 1024);
      } catch {
        // doc apply will retry
      }
    }
  };

  // Markers ------------------------------------------------------------------

  const upsertMarkerRow = (marker: Marker) => {
    if (!session.client) return;
    const row = convertMarkerToDbFormat(marker, selectedSceneId);
    session.client.write.setMarkerFields(selectedSceneId, marker.id, {
      ...row,
      sceneId: selectedSceneId
    } as Partial<MarkerRow>);
  };

  const onMarkerAdded = (marker: Marker) => {
    stageProps.marker.markers = [...stageProps.marker.markers, marker];
    selectedMarkerId = marker.id;
    setSelection([marker.id]);
    upsertMarkerRow(marker);
    trackChecklistItemLocal('place-marker');
  };

  const writeMarkerPosition = throttle((markerId: string, position: { x: number; y: number }) => {
    session.client?.write.setMarkerFields(selectedSceneId, markerId, { positionX: position.x, positionY: position.y });
  }, 50);
  const dragClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const onMarkerMoved = (marker: Marker, position: { x: number; y: number }) => {
    const target = stageProps.marker.markers.find((m: Marker) => m.id === marker.id);
    if (!target || (target.position.x === position.x && target.position.y === position.y)) return;
    // Mutate in place — replacing the marker object would retrigger every
    // effect that reads it (notably the token's canvas/texture redraw) on
    // each pointermove
    target.position = { x: position.x, y: position.y };
    dragPositions[marker.id] = position;
    writeMarkerPosition(marker.id, position);

    clearTimeout(dragClearTimers.get(marker.id));
    dragClearTimers.set(
      marker.id,
      setTimeout(() => {
        session.client?.write.setMarkerFields(selectedSceneId, marker.id, {
          positionX: position.x,
          positionY: position.y
        });
        delete dragPositions[marker.id];
        dragClearTimers.delete(marker.id);
      }, 300)
    );
  };

  // Group drag writes one transaction per throttle tick (the single-marker throttle keeps only
  // the last call's arguments, which would drop the other members) and one undo step per gesture:
  // the group opens on the first move and closes when the stage reports the gesture ended.
  // Writes skip rows that no longer exist (deleted by another editor mid-drag) instead of recreating them.
  let groupDragPending: Record<string, { x: number; y: number }> = {};
  let groupDragFinal: Record<string, { x: number; y: number }> = {};
  let groupDragSceneId: string | undefined;

  const writeGroupMoves = (sceneId: string, moves: Record<string, { x: number; y: number }>) => {
    const client = session.client;
    if (!client) return;
    client.write.transaction(() => {
      for (const [id, p] of Object.entries(moves)) {
        client.write.setExistingMarkerFields(sceneId, id, { positionX: p.x, positionY: p.y });
      }
    });
  };

  const writeGroupPositions = throttle(() => {
    const batch = groupDragPending;
    groupDragPending = {};
    if (groupDragSceneId) writeGroupMoves(groupDragSceneId, batch);
  }, 50);

  const finishGroupDrag = ({ discard = false }: { discard?: boolean } = {}) => {
    if (groupDragSceneId === undefined) return;
    const ids = Object.keys(groupDragFinal);
    writeGroupMoves(groupDragSceneId, groupDragFinal);
    for (const id of ids) delete dragPositions[id];
    groupDragFinal = {};
    groupDragPending = {};
    groupDragSceneId = undefined;
    session.client?.endUndoGroup({ discard });
  };

  const onMarkersMoved = (moves: Array<{ marker: Marker; position: { x: number; y: number } }>) => {
    if (groupDragSceneId === undefined) {
      groupDragSceneId = selectedSceneId;
      session.client?.beginUndoGroup();
    }
    for (const { marker, position } of moves) {
      const target = stageProps.marker.markers.find((m: Marker) => m.id === marker.id);
      if (!target) {
        delete groupDragPending[marker.id];
        delete groupDragFinal[marker.id];
        continue;
      }
      target.position = { x: position.x, y: position.y };
      dragPositions[marker.id] = position;
      groupDragPending[marker.id] = position;
      groupDragFinal[marker.id] = position;
    }
    writeGroupPositions();
  };

  // Escape-cancel already moved the members back, so the gesture's undo step is dropped
  const onMarkersMoveEnd = ({ cancelled }: { ids: string[]; cancelled: boolean }) =>
    finishGroupDrag({ discard: cancelled });

  const onMarkerSelected = (marker: Marker | null) => {
    selectedMarkerId = marker?.id || undefined;
    setSelection(marker ? [marker.id] : []);
  };

  // Double-clicking a marker opens its editing panel even when collapsed
  const onMarkerDoubleClick = (marker: Marker) => {
    selectedMarkerId = marker.id;
    if (isMarkersCollapsed) {
      markersPane.expand();
    }
  };

  // Right-click opens the token panel for the selection the token belongs to; touch devices use the marker panel
  let tokenPanel = $state<{ markerId: string; x: number; y: number } | null>(null);
  const tokenPanelMarker = $derived(stageProps.marker.markers.find((m) => m.id === tokenPanel?.markerId));

  const onMarkerContextMenu = (marker: Marker, event: MouseEvent | TouchEvent) => {
    if (!(event instanceof MouseEvent)) return;
    markerContextMenuOpenedAt = performance.now();
    if (!selectedMarkerIds.includes(marker.id)) setSelection([marker.id]);
    selectedMarkerId = marker.id;
    tokenPanel = { markerId: marker.id, x: event.clientX, y: event.clientY };
  };

  const setMarkerVisibility = (markerId: string, visibility: MarkerVisibility) => {
    updateMarkerAndSave(markerId, (m) => (m.visibility = visibility));
    // Mirrors the marker panel: DM-only markers can't stay pinned for players
    if (visibility === MarkerVisibility.DM && pinnedMarkerIds.includes(markerId)) {
      onPinToggle(markerId, false);
    }
    if (visibility === MarkerVisibility.Always || visibility === MarkerVisibility.Hover) {
      trackChecklistItemLocal('marker-visibility');
    }
  };

  const markerRowFor = (markerId: string) =>
    session.client?.scene(selectedSceneId)?.markers.find((row) => row.id === markerId);

  const storedConditionsOf = (markerId: string): MarkerCondition[] => markerRowFor(markerId)?.conditions ?? [];

  const customConditionSuggestions = $derived.by(() => {
    const byId = new Map<string, MarkerCondition>();
    for (const marker of stageProps.marker.markers) {
      for (const condition of marker.conditions ?? []) {
        if (condition.id.startsWith('custom:') && !byId.has(condition.id)) byId.set(condition.id, condition);
      }
    }
    return [...byId.values()];
  });

  const writeMarkerConditions = (targetIds: string[], update: (stored: MarkerCondition[]) => MarkerCondition[]) => {
    const client = session.client;
    if (!client) return;
    const updates = targetIds.map((id) => ({ id, conditions: update(storedConditionsOf(id)) }));
    for (const { id, conditions } of updates) {
      const marker = stageProps.marker.markers.find((m) => m.id === id);
      if (marker) marker.conditions = conditions;
    }
    client.stopCapturing();
    client.write.transaction(() => {
      for (const { id, conditions } of updates) client.write.setMarkerFields(selectedSceneId, id, { conditions });
    });
    client.stopCapturing();
  };

  const toggleConditionOn = (targetIds: string[], condition: MarkerCondition) => {
    const allHave = targetIds.every((id) => storedConditionsOf(id).some((c) => c.id === condition.id));
    const incoming: MarkerCondition =
      condition.id === 'exhaustion' ? { id: condition.id, value: condition.value ?? 1 } : { ...condition };
    writeMarkerConditions(targetIds, (stored) => {
      const present = stored.some((c) => c.id === condition.id);
      if (allHave) return sortConditions(stored.filter((c) => c.id !== condition.id));
      return present ? stored : sortConditions([...stored, incoming]);
    });
  };

  const stepConditionValueOn = (targetIds: string[], id: string, delta: number) =>
    writeMarkerConditions(targetIds, (stored) => stepConditionValue(stored, id, delta));

  const toggleConditionDmOnly = (targetIds: string[], id: string) =>
    writeMarkerConditions(targetIds, (stored) =>
      stored.map((c) => {
        if (c.id !== id) return c;
        const { dmOnly, ...rest } = c;
        return dmOnly ? rest : { ...rest, dmOnly: true };
      })
    );

  const clearConditions = (targetIds: string[]) => writeMarkerConditions(targetIds, () => []);

  const conditionPickerFor = (targetIds: string[]): ComponentProps<typeof TokenContextPanel>['conditions'] => {
    // Stored rows, not stageProps: stage markers carry the derived Bloodied, which is never written
    const rows = targetIds.flatMap((id) => markerRowFor(id) ?? []);
    return {
      ...conditionPickerState(rows),
      customSuggestions: customConditionSuggestions,
      onToggle: (condition) => toggleConditionOn(targetIds, condition),
      onStepValue: (id, delta) => stepConditionValueOn(targetIds, id, delta),
      onToggleDmOnly: (id) => toggleConditionDmOnly(targetIds, id),
      onClear: () => clearConditions(targetIds)
    };
  };

  const writeHitPoints = (markerId: string, fields: { hitPoints?: number | null; tempHitPoints?: number | null }) =>
    session.client?.write.setMarkerFields(selectedSceneId, markerId, fields);

  const statBlockFor = (markerId: string) => {
    const row = markerRowFor(markerId);
    if (!row?.statBlock) return null;
    return { statBlock: row.statBlock, hitPoints: row.hitPoints ?? null, tempHitPoints: row.tempHitPoints ?? null };
  };

  const quickCardRow = $derived.by(() => {
    if (selectedMarkerIds.length !== 1) return undefined;
    const row = markerRowFor(selectedMarkerIds[0]);
    return row?.statBlock ? row : undefined;
  });

  const onStatRoll = (label: string, _formula: string, roll: StatBlockRoll) =>
    addToast({ data: { title: `${label}: ${roll.total}`, body: roll.text, type: 'info' } });

  const setQuickCardCollapsed = (collapsed: boolean) => {
    statBlockQuickCardCollapsed = collapsed;
    setPreference('statBlockQuickCardCollapsed', collapsed);
  };

  const deleteTokenPanelTargets = () => {
    const ids = [...selectedMarkerIds];
    ids.forEach((id) => onMarkerDeleted(id));
    if (selectedMarkerId && ids.includes(selectedMarkerId)) selectedMarkerId = undefined;
  };

  const openFullStatBlock = (markerId: string) => {
    selectedMarkerId = markerId;
    markersPane?.expand();
  };

  // Combat -------------------------------------------------------------------------

  const combatSnapshot = $derived(session.client?.scene(selectedSceneId) ?? null);
  // Memoized so unrelated marker writes (drags) don't rebuild the tracker
  let combatantsCache: MarkerRow[] = [];
  const combatants = $derived.by(() => {
    const next = (combatSnapshot?.markers ?? []).filter((m) => m.inCombat);
    if (sameCombatantView(next, combatantsCache)) return combatantsCache;
    combatantsCache = next;
    return next;
  });
  const combatantIds = $derived(new Set(combatants.map((m) => m.id)));
  const combatRunning = $derived(combatants.length > 0);
  let turnPositionCache: TurnPosition = readTurnPosition({});
  const turnPosition = $derived.by(() => {
    const next = readTurnPosition(combatSnapshot?.settings ?? {});
    if (isSameTurn(next, turnPositionCache)) return turnPositionCache;
    turnPositionCache = next;
    return next;
  });
  const activeTurnMarkerId = $derived(
    !turnPosition.lairStep && turnPosition.activeId && combatantIds.has(turnPosition.activeId)
      ? turnPosition.activeId
      : null
  );
  const targetsInCombat = $derived(selectedMarkerIds.filter((id) => combatantIds.has(id)).length);

  // The active combatant can vanish without removeCombatants (undo of its placement, a sync delete)
  let previousCombat: { sceneId: string; combatants: MarkerRow[] } | null = null;
  $effect(() => {
    const sceneId = selectedSceneId;
    const current = combatants;
    void turnPosition;
    untrack(() => {
      const previous = previousCombat?.sceneId === sceneId ? previousCombat.combatants : [];
      previousCombat = { sceneId, combatants: current };
      const client = session.client;
      const snapshot = client?.scene(sceneId);
      if (client && snapshot) recoverActiveTurn(client.systemWrite, sceneId, snapshot, previous);
    });
  });

  const reportRolls = (lines: string[]) => {
    if (lines.length === 0) return;
    if (lines.length <= 3) {
      for (const line of lines) addToast({ data: { title: line, type: 'info' } });
      return;
    }
    addToast({
      data: { title: `Rolled initiative for ${lines.length} combatants`, body: lines.join('\n'), type: 'info' }
    });
  };

  // Next turn selects the active token so the quick stat card follows it
  const announceTurn = (turn: TurnPosition | null) => {
    if (!turn) return;
    const followIds = turn.lairStep || !turn.activeId ? [] : [turn.activeId];
    selectedMarkerId = followIds[0];
    setSelection(followIds);
    if (sidePanelTab === 'combat') return;
    const activeTitle = session.client?.scene(selectedSceneId)?.markers.find((m) => m.id === turn.activeId)?.title;
    const body = turn.lairStep ? 'Lair action' : `${activeTitle || 'Next'}'s turn`;
    addToast({ data: { title: `Round ${turn.round} · ${body}`, type: 'info' } });
  };

  const handleCombatAction = (action: CombatAction) => {
    const client = session.client;
    const snapshot = client?.scene(selectedSceneId);
    if (!client || !snapshot) return;
    const write = client.systemWrite;
    const sceneId = selectedSceneId;
    switch (action.type) {
      case 'start':
        startCombat(write, sceneId, snapshot, action.ids);
        openSidePanelTab('combat');
        break;
      case 'add':
        addCombatants(write, sceneId, snapshot, action.ids);
        break;
      case 'remove':
        removeCombatants(write, sceneId, snapshot, action.ids);
        break;
      case 'setInitiative':
        setInitiative(write, sceneId, snapshot, action.id, action.value);
        break;
      case 'rollEmpty':
        reportRolls(rollEmpty(write, sceneId, snapshot));
        break;
      case 'rerollAll':
        reportRolls(rerollAll(write, sceneId, snapshot));
        break;
      case 'rollOne':
        reportRolls(rollOne(write, sceneId, snapshot, action.id));
        break;
      case 'nudgeTie':
        nudgeTie(write, sceneId, snapshot, action.id, action.direction);
        break;
      case 'begin':
        announceTurn(beginCombat(write, sceneId, snapshot));
        break;
      case 'next':
        announceTurn(nextTurn(write, sceneId, snapshot));
        break;
      case 'previous':
        announceTurn(previousTurn(write, sceneId, snapshot));
        break;
      case 'end':
        endCombat(write, sceneId, snapshot);
        break;
    }
  };

  const handleTokenCombatAction = (action: 'start' | 'add' | 'remove') =>
    handleCombatAction({ type: action, ids: [...selectedMarkerIds] });

  const startOrAddCombat = () => {
    if (selectedMarkerIds.length === 0) {
      addToast({ data: { title: 'Select tokens to add to combat', type: 'info' } });
      return;
    }
    handleCombatAction({ type: combatRunning ? 'add' : 'start', ids: [...selectedMarkerIds] });
  };

  const advanceCombat = () => {
    if (!combatRunning) {
      addToast({ data: { title: 'No combat running. Select tokens and press I', type: 'info' } });
      return;
    }
    handleCombatAction({ type: turnPosition.round === 0 ? 'begin' : 'next' });
  };

  const rewindCombat = () => {
    if (combatRunning && turnPosition.round > 0) handleCombatAction({ type: 'previous' });
  };

  const onInitiativeBonusChange = (markerId: string, bonus: number | null) => {
    const client = session.client;
    const snapshot = client?.scene(selectedSceneId);
    if (!client || !snapshot) return;
    setInitiativeBonus(client.systemWrite, selectedSceneId, markerId, bonus);
    const assetId = snapshot.markers.find((m) => m.id === markerId)?.assetId;
    if (!assetId) return;
    assetMutation.mutateAsync({ action: 'save', fields: { id: assetId, initiativeBonus: bonus } }).catch((error) =>
      addToast({
        data: {
          title: 'Initiative bonus not saved to the library',
          body: error instanceof Error ? error.message : 'Save failed',
          type: 'danger'
        }
      })
    );
  };

  const onMarkerDeleted = (markerId: string) => {
    const client = session.client;
    const snapshot = client?.scene(selectedSceneId);
    if (client && snapshot && combatantIds.has(markerId)) {
      removeCombatants(client.systemWrite, selectedSceneId, snapshot, [markerId]);
    }
    stageProps.marker.markers = stageProps.marker.markers.filter((m) => m.id !== markerId);
    session.client?.write.deleteMarker(selectedSceneId, markerId);
  };

  const updateMarkerAndSave = (markerId: string, updateFn: (marker: Marker) => void) => {
    const markerIndex = stageProps.marker.markers.findIndex((m: Marker) => m.id === markerId);
    if (markerIndex === -1) return;
    updateFn(stageProps.marker.markers[markerIndex]);
    stageProps.marker.markers = [...stageProps.marker.markers];
    upsertMarkerRow(stageProps.marker.markers[markerIndex]);
  };

  const onPinToggle = (markerId: string, pinned: boolean) => {
    if (stageProps.mode !== StageMode.DM) return;
    const markerIndex = stageProps.marker.markers.findIndex((m) => m.id === markerId);
    if (markerIndex === -1) return;
    stageProps.marker.markers[markerIndex].pinnedTooltip = pinned;
    session.client?.write.setMarkerFields(selectedSceneId, markerId, { pinnedTooltip: pinned });
  };

  const onMarkerHover = (marker: Marker | null) => {
    if (stageProps.mode !== StageMode.DM) return;
    if (marker && marker.visibility === MarkerVisibility.Hover) {
      hoveredMarker = {
        id: marker.id,
        position: { x: marker.position.x, y: marker.position.y, z: 0 },
        tooltip: {
          title: marker.title,
          content: marker.note ? JSON.stringify(marker.note) : '',
          imageUrl: marker.imageUrl || undefined
        }
      };
      session.presence?.updateHoveredMarker(hoveredMarker);
    } else {
      hoveredMarker = null;
      session.presence?.updateHoveredMarker(null);
    }
  };

  // Lights ---------------------------------------------------------------------

  const writeLightRow = (light: Light) => {
    session.client?.write.setLightFields(selectedSceneId, light.id, {
      id: light.id,
      sceneId: selectedSceneId,
      positionX: light.position.x,
      positionY: light.position.y,
      radius: light.radius,
      color: light.color,
      style: light.style,
      pulse: light.pulse,
      opacity: light.opacity ?? 1
    });
  };

  const onLightAdded = (light: Light) => {
    stageProps.light.lights = [...stageProps.light.lights, light];
    selectedLightId = light.id;
    trackChecklistItemLocal('add-light');
    writeLightRow(light);
  };

  const onLightMoved = (light: Light, position: { x: number; y: number }) => {
    const index = stageProps.light.lights.findIndex((l: Light) => l.id === light.id);
    if (index === -1) return;
    stageProps.light.lights[index] = { ...light, position: { x: position.x, y: position.y } };
    writeLightRow(stageProps.light.lights[index]);
  };

  const onLightSelected = (light: Light | null) => {
    selectedLightId = light?.id || undefined;
  };

  const onLightDeleted = (lightId: string) => {
    stageProps.light.lights = stageProps.light.lights.filter((l) => l.id !== lightId);
    session.client?.write.deleteLight(selectedSceneId, lightId);
  };

  const updateLightAndSave = (lightId: string, updateFn: (light: Light) => void) => {
    const lightIndex = stageProps.light.lights.findIndex((l: Light) => l.id === lightId);
    if (lightIndex === -1) return;
    updateFn(stageProps.light.lights[lightIndex]);
    stageProps.light.lights = [...stageProps.light.lights];
    writeLightRow(stageProps.light.lights[lightIndex]);
  };

  // Annotations ------------------------------------------------------------------

  // AoE templates ------------------------------------------------------------------

  const AOE_SHAPE_CYCLE = [AoeShape.Circle, AoeShape.Square, AoeShape.Cone, AoeShape.Line];

  const aoeRowFromTemplate = (template: AoeTemplate): AoeTemplateRow => ({
    id: template.id,
    sceneId: selectedSceneId,
    shape: template.shape as AoeTemplateRow['shape'],
    positionX: template.position.x,
    positionY: template.position.y,
    angle: template.angle,
    size: template.size,
    width: template.width,
    effect: template.effect,
    color: template.color,
    opacity: template.opacity,
    visibility: template.visibility,
    label: template.label ?? null,
    anchorMarkerId: null,
    createdAt: Math.floor(Date.now() / 1000)
  });

  const aoeFieldsFromPatch = (patch: Partial<Omit<AoeTemplate, 'id'>>): Partial<AoeTemplateRow> => {
    const { position, shape, ...rest } = patch;
    return {
      ...rest,
      ...(position && { positionX: position.x, positionY: position.y }),
      ...(shape && { shape: shape as AoeTemplateRow['shape'] })
    };
  };

  const updateAoeTemplate = (id: string, patch: Partial<Omit<AoeTemplate, 'id'>>) => {
    const layer = stageProps.aoeTemplates;
    if (!layer?.templates.some((template) => template.id === id)) return;
    layer.templates = layer.templates.map((template) => (template.id === id ? { ...template, ...patch } : template));
    session.client?.write.setAoeTemplateFields(selectedSceneId, id, aoeFieldsFromPatch(patch));
  };

  const removeAoeTemplate = (id: string) => {
    const layer = stageProps.aoeTemplates;
    if (!layer) return;
    layer.templates = layer.templates.filter((template) => template.id !== id);
    if (layer.selectedId === id) layer.selectedId = null;
    session.client?.write.deleteAoeTemplate(selectedSceneId, id);
  };

  const selectAoeTemplate = (id: string | null) => {
    if (stageProps.aoeTemplates) stageProps.aoeTemplates.selectedId = id;
  };

  const changeAoeTool = (patch: Partial<AoeToolSettings>) => {
    const layer = stageProps.aoeTemplates;
    if (!layer) return;
    layer.tool = { ...layer.tool, ...patch };
    setPreference('aoeTool', layer.tool);
  };

  const onAoeTemplateAdded = (template: AoeTemplate) => {
    const layer = stageProps.aoeTemplates;
    if (!layer) return;
    layer.templates = [...layer.templates, template];
    layer.selectedId = template.id;
    session.client?.write.upsertAoeTemplate(selectedSceneId, aoeRowFromTemplate(template));
  };

  const aoeKeyCommands = {
    hasDraft: () => stage?.aoeTemplates?.hasDraft() ?? false,
    cancelDraft: () => stage?.aoeTemplates?.cancelDraft(),
    deselect: () => selectAoeTemplate(null),
    deleteSelected: () => {
      const id = stageProps.aoeTemplates?.selectedId;
      if (id) removeAoeTemplate(id);
    },
    rotateSelected: (delta: number) => {
      const layer = stageProps.aoeTemplates;
      const target = layer?.templates.find((template) => template.id === layer.selectedId);
      if (target) updateAoeTemplate(target.id, { angle: rotateTemplateAngle(target.shape, target.angle, delta) });
    },
    cycleShape: () => {
      const tool = stageProps.aoeTemplates?.tool;
      if (!tool) return;
      changeAoeTool({ shape: AOE_SHAPE_CYCLE[(AOE_SHAPE_CYCLE.indexOf(tool.shape) + 1) % AOE_SHAPE_CYCLE.length] });
    }
  };

  const annotationColors = [
    '#d73e2e',
    '#ffa500',
    '#ffd93d',
    '#6bcf7f',
    '#2e86ab',
    '#b197fc',
    '#f06595',
    '#20c997',
    '#845ef7',
    '#4c6ef5',
    '#15803d',
    '#dc2626',
    '#06b6d4',
    '#ec4899',
    '#8b5cf6',
    '#059669'
  ];

  const annotationRowFromLayer = (layer: AnnotationLayerData, order: number): AnnotationRow => ({
    id: layer.id,
    sceneId: selectedSceneId,
    name: layer.name || 'New Annotation',
    opacity: typeof layer.opacity === 'number' ? layer.opacity : 1.0,
    color: layer.color || '#FF0000',
    url: layer.url?.startsWith('https://') ? (extractLocationFromUrl(layer.url) ?? layer.url) : (layer.url ?? null),
    visibility: layer.visibility,
    order,
    effectType: layer.effect?.type ?? null
  });

  const onAnnotationCreated = () => {
    const newAnnotation: AnnotationLayerData = {
      id: crypto.randomUUID(),
      name: `Drawing ${stageProps.annotations.layers.length + 1}`,
      color: annotationColors[Math.floor(Math.random() * annotationColors.length)],
      opacity: 1.0,
      visibility: StageMode.Player,
      url: null
    };

    stageProps.annotations.layers = [newAnnotation, ...stageProps.annotations.layers];
    queuePropertyUpdate(stageProps, ['annotations', 'activeLayer'], newAnnotation.id, 'control');
    queuePropertyUpdate(stageProps, ['activeLayer'], MapLayerType.Annotation, 'control');
    selectedAnnotationId = newAnnotation.id;
    if (activeControl !== 'annotation') handleSelectActiveControl('annotation');

    if (session.client) {
      const snapshot = session.client.scene(selectedSceneId);
      const minOrder = Math.min(1, ...(snapshot?.annotations.map((a) => a.order) ?? []));
      session.client.write.upsertAnnotation(selectedSceneId, annotationRowFromLayer(newAnnotation, minOrder - 1));
    }
  };

  const onAnnotationUpdated = (annotation: AnnotationLayerData) => {
    const index = stageProps.annotations.layers.findIndex((a) => a.id === annotation.id);
    session.client?.write.upsertAnnotation(selectedSceneId, annotationRowFromLayer(annotation, Math.max(index, 0)));
  };

  const onAnnotationDeleted = (annotationId: string) => {
    const remainingLayers = stageProps.annotations.layers.filter((layer) => layer.id !== annotationId);
    stageProps.annotations.layers = remainingLayers;
    if (remainingLayers.length > 0) {
      stageProps.annotations.activeLayer = remainingLayers[0].id;
    } else {
      // Leave the draw tool armed: create-on-first-use spawns a fresh layer,
      // so the brush cursor survives deleting the last layer
      stageProps.annotations.activeLayer = null;
    }
    session.client?.write.deleteAnnotation(selectedSceneId, annotationId);
  };

  // Annotation mask strokes -> doc, debounced per layer
  const pendingAnnotationCommits = new Map<string, { timer: ReturnType<typeof setTimeout>; sceneId: string }>();

  const commitAnnotationMask = async (sceneId: string, layerId: string) => {
    if (!session.client || !stage?.annotations) return;
    if (stage.annotations.isDrawing()) return;

    // toRLE reads the active layer; point it at the target temporarily
    const originalActiveLayer = stageProps.annotations.activeLayer;
    stageProps.annotations.activeLayer = layerId;
    try {
      const rle = await stage.annotations.toRLE();
      if (rle && rle.length > 0) {
        session.client.write.setAnnotationMask(sceneId, layerId, rle);
      }
    } finally {
      stageProps.annotations.activeLayer = originalActiveLayer;
    }
  };

  // Like fog: pending commits land on the scene the stroke was drawn on, flushed
  // on scene switch while the stage still holds that scene's layers
  $effect(() => {
    for (const [layerId, pending] of pendingAnnotationCommits) {
      if (pending.sceneId !== selectedSceneId) {
        pendingAnnotationCommits.delete(layerId);
        clearTimeout(pending.timer);
        commitAnnotationMask(pending.sceneId, layerId);
      }
    }
  });

  const flushPendingAnnotationCommits = () => {
    const flushes: Promise<void>[] = [];
    for (const [layerId, pending] of pendingAnnotationCommits) {
      pendingAnnotationCommits.delete(layerId);
      clearTimeout(pending.timer);
      flushes.push(commitAnnotationMask(pending.sceneId, layerId));
    }
    return Promise.all(flushes);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onAnnotationUpdate = (layerId: string, _getBlob: () => Promise<Blob>) => {
    const existing = pendingAnnotationCommits.get(layerId);
    if (existing) clearTimeout(existing.timer);
    const sceneId = selectedSceneId;
    pendingAnnotationCommits.set(layerId, {
      sceneId,
      timer: setTimeout(() => {
        pendingAnnotationCommits.delete(layerId);
        if (selectedSceneId === sceneId) commitAnnotationMask(sceneId, layerId);
      }, 500)
    });
  };

  // Fog of war -------------------------------------------------------------------

  let pendingFogCommit: { timer: ReturnType<typeof setTimeout>; sceneId: string } | null = null;

  const commitFogMask = async (sceneId: string) => {
    if (!session.client || !stage?.fogOfWar) return;
    if (stage.fogOfWar.isDrawing()) return; // next stroke end re-arms
    const rle = await stage.fogOfWar.toRLE();
    if (rle && !stage.fogOfWar.isDrawing()) {
      session.client.write.setFogMask(sceneId, rle);
    }
  };

  // A pending commit must land on the scene the stroke was drawn on. Flushing at
  // switch time is safe: the fog canvas still shows that scene's mask until the
  // new map texture loads and applyMasks repaints it.
  const flushPendingFogCommit = () => {
    if (!pendingFogCommit) return Promise.resolve();
    const { timer, sceneId } = pendingFogCommit;
    pendingFogCommit = null;
    clearTimeout(timer);
    return commitFogMask(sceneId);
  };

  $effect(() => {
    if (pendingFogCommit && pendingFogCommit.sceneId !== selectedSceneId) flushPendingFogCommit();
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onFogUpdate = (_getBlob: () => Promise<Blob>) => {
    trackChecklistItemLocal('fog-erase');
    if (pendingFogCommit) clearTimeout(pendingFogCommit.timer);
    const sceneId = selectedSceneId;
    pendingFogCommit = {
      sceneId,
      timer: setTimeout(() => {
        pendingFogCommit = null;
        if (selectedSceneId === sceneId) commitFogMask(sceneId);
      }, 500)
    };
  };

  // Polygon fog rooms are synced scene settings (fogOfWarRooms JSON), so
  // writing the whole array through queuePropertyUpdate gives realtime sync
  // and undo for free
  const onFogRoomAdd = (points: { x: number; y: number }[]) => {
    const rooms = [...stageProps.fogOfWar.rooms, { id: crypto.randomUUID(), points, enabled: true }];
    queuePropertyUpdate(stageProps, ['fogOfWar', 'rooms'], rooms, 'control');
    trackChecklistItemLocal('fog-room');
  };

  // Room toggling works from any layer, so a right-click on a marker inside a
  // room fires both this and onMarkerContextMenu (same event, synchronous).
  // Defer one tick and let the marker's menu win.
  let markerContextMenuOpenedAt = 0;

  const onFogRoomToggle = (roomId: string) => {
    setTimeout(() => {
      if (performance.now() - markerContextMenuOpenedAt < 100) return;
      const rooms = stageProps.fogOfWar.rooms.map((room) =>
        room.id === roomId ? { ...room, enabled: !room.enabled } : room
      );
      queuePropertyUpdate(stageProps, ['fogOfWar', 'rooms'], rooms, 'control');
    }, 0);
  };

  const onFogRoomDelete = (roomId: string) => {
    const rooms = stageProps.fogOfWar.rooms.filter((room) => room.id !== roomId);
    queuePropertyUpdate(stageProps, ['fogOfWar', 'rooms'], rooms, 'control');
  };

  // Clearing fog wipes the rooms too; flushing the debounced mask commit keeps
  // both writes in the same undo capture group
  const clearFogAndRooms = () => {
    stage?.fogOfWar.clear();
    queuePropertyUpdate(stageProps, ['fogOfWar', 'rooms'], [], 'control');
    flushPendingFogCommit();
  };

  // A scene switch invalidates the in-progress polygon's coordinate space
  $effect(() => {
    void selectedSceneId;
    stage?.fogOfWar?.cancelPolygon();
    stage?.aoeTemplates?.cancelDraft();
  });

  // Measurements (broadcast only when editing the active scene) -------------------

  const isOnActiveScene = () => selectedSceneId === partyState.activeSceneId;

  const measurementStyle = () => ({
    color: stageProps.measurement.color,
    thickness: stageProps.measurement.thickness,
    outlineColor: stageProps.measurement.outlineColor,
    outlineThickness: stageProps.measurement.outlineThickness,
    opacity: stageProps.measurement.opacity,
    markerSize: stageProps.measurement.markerSize,
    autoHideDelay: stageProps.measurement.autoHideDelay,
    fadeoutTime: stageProps.measurement.fadeoutTime,
    showDistance: stageProps.measurement.showDistance,
    snapToGrid: stageProps.measurement.snapToGrid,
    enableDMG252: stageProps.measurement.enableDMG252,
    beamWidth: stageProps.measurement.beamWidth,
    coneAngle: stageProps.measurement.coneAngle
  });

  const onMeasurementStart = (startPoint: { x: number; y: number }, type: number) => {
    if (!isOnActiveScene()) return;
    session.presence?.updateMeasurement(startPoint, startPoint, type, measurementStyle());
  };

  const onMeasurementUpdate = (
    startPoint: { x: number; y: number },
    endPoint: { x: number; y: number },
    type: number
  ) => {
    if (!isOnActiveScene()) return;
    session.presence?.updateMeasurement(startPoint, endPoint, type, measurementStyle());
  };

  const onMeasurementEnd = () => {
    if (!isOnActiveScene()) return;
    session.presence?.updateMeasurement(null, null, 0);
  };

  // Cursor + viewport interaction ---------------------------------------------------

  const userColor = untrack(
    () =>
      `#${Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, '0')}`
  );
  const throttledCursorUpdate = throttle((worldPosition: { x: number; y: number; z: number }) => {
    session.presence?.updateCursor(worldPosition, userColor, user.email);
  }, 33);

  const handleCursorMove = (worldPosition: { x: number; y: number; z: number }) => {
    if (isOnActiveScene()) throttledCursorUpdate(worldPosition);
  };

  const throttledZoomHandler = throttle((e: WheelEvent, props: StageProps) => {
    handleStageZoom(e, props);
  }, 50);

  const onMouseMove = (e: MouseEvent) => {
    if (e.target instanceof HTMLCanvasElement) {
      const point = stage?.markers.clientToPosition({ x: e.clientX, y: e.clientY }, true);
      if (point) clipboardPointer = { sceneId: selectedSceneId, point };
    }
    const rotation = stageProps.scene.rotation;
    const canvasBounds = stageElement?.getBoundingClientRect();
    if (!canvasBounds) return;

    const cursorX = e.clientX - canvasBounds.left;
    const cursorY = e.clientY - canvasBounds.top;
    const displayWidth = stageProps.display.resolution.x * stageProps.scene.zoom;
    const displayHeight = stageProps.display.resolution.y * stageProps.scene.zoom;
    const rotatedWidth = rotation % 180 === 0 ? displayWidth : displayHeight;
    const rotatedHeight = rotation % 180 === 0 ? displayHeight : displayWidth;
    const horizontalMargin = (canvasBounds.width - rotatedWidth) / 2;
    const verticalMargin = (canvasBounds.height - rotatedHeight) / 2;
    const relativeX = cursorX - horizontalMargin;
    const relativeY = cursorY - verticalMargin;
    isCursorInScene = relativeX >= 0 && relativeX <= rotatedWidth && relativeY >= 0 && relativeY <= rotatedHeight;
  };

  // In map-defined mode the map zoom is locked (derived from the grid) and
  // rotation snaps to 90° steps; panning stays free — grid, tokens, fog and
  // drawings are anchored to the map and ride along
  const isMapDefinedMode = $derived((stageProps.grid.gridMode ?? GridMode.FillSpace) === GridMode.MapDefined);

  function onMapPan(dx: number, dy: number) {
    queuePropertyUpdate(stageProps, ['map', 'offset', 'x'], stageProps.map.offset.x + dx, 'control');
    queuePropertyUpdate(stageProps, ['map', 'offset', 'y'], stageProps.map.offset.y + dy, 'control');
  }

  function onMapRotate(angle: number) {
    queuePropertyUpdate(stageProps, ['map', 'rotation'], angle, 'control');
    // In map-defined mode rotation snaps to 90° steps and swaps the map's
    // effective axes, so the locked zoom must follow
    relockMapZoom(stageProps, stage);
  }

  function onMapZoom(zoom: number) {
    if (isMapDefinedMode) return;
    queuePropertyUpdate(stageProps, ['map', 'zoom'], zoom, 'control');
  }

  function onScenePan(dx: number, dy: number) {
    stageProps.scene.autoFit = false;
    stageProps.scene.offset.x += dx;
    stageProps.scene.offset.y += dy;
  }

  function onSceneRotate(angle: number) {
    stageProps.scene.rotation = angle;
  }

  function onSceneZoom(zoom: number) {
    stageProps.scene.autoFit = false;
    queuePropertyUpdate(stageProps, ['scene', 'zoom'], zoom, 'control');
  }

  // Brush sizes step through discrete values, so accumulate wheel deltas and
  // emit one step (+1 grows, -1 shrinks) per ~100 units (one wheel notch)
  let brushWheelAccum = 0;
  const brushWheelStep = (e: WheelEvent): number => {
    brushWheelAccum += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(brushWheelAccum) < 100) return 0;
    const direction = brushWheelAccum > 0 ? -1 : 1;
    brushWheelAccum = 0;
    return direction;
  };

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();

    if (stageProps.activeLayer === MapLayerType.Annotation && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      const direction = brushWheelStep(e);
      if (direction === 0) return;
      const currentIndex = ANNOTATION_BRUSH_SIZES.indexOf(snapAnnotationBrush(stageProps.annotations.lineWidth || 0.5));
      const newLineWidth =
        ANNOTATION_BRUSH_SIZES[Math.max(0, Math.min(ANNOTATION_BRUSH_SIZES.length - 1, currentIndex + direction))];
      stageProps.annotations.lineWidth = newLineWidth;
      setPreference('annotationLineWidthGridUnits', newLineWidth);
      return;
    }

    if (stageProps.activeLayer === MapLayerType.FogOfWar && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      const direction = brushWheelStep(e);
      if (direction === 0) return;
      const newSize = clampFogBrush((stageProps.fogOfWar.tool.size || 2) + direction);
      stageProps.fogOfWar.tool.size = newSize;
      setPreference('brushSizeGridUnits', newSize);
      return;
    }

    throttledZoomHandler(e, stageProps);
  };

  // Keyboard -------------------------------------------------------------------

  const handleKeydown = (event: KeyboardEvent) => {
    if (catalogOpen) return;
    const activeElement = document.activeElement as HTMLElement | null;
    if (
      activeElement &&
      (activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'SELECT' ||
        activeElement.isContentEditable)
    ) {
      return;
    }

    if (event.key === 'Escape' && !event.defaultPrevented && !stage?.markers?.isDraggingMarker) {
      if (stageProps.activeLayer === MapLayerType.None) setSelection([]);
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && !catalogOpen) {
      const key = event.key.toLowerCase();
      if ((key === 'i' || key === 'n') && event.repeat) return;
      if (key === 'i') return startOrAddCombat();
      if (key === 'n') return event.shiftKey ? rewindCombat() : advanceCombat();
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'a' && !event.shiftKey) {
        if (![MapLayerType.None, MapLayerType.Marker].includes(stageProps.activeLayer)) return;
        event.preventDefault();
        setSelection(
          stageProps.marker.markers.filter((m) => m.visibility !== MarkerVisibility.Player).map((m) => m.id)
        );
        return;
      }
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        if (!session.client) return;
        const client = session.client;
        const isRedo = key === 'y' || event.shiftKey;
        // Debounced mask commits and throttled property writes (fog rooms) must
        // land on the undo stack before we pop it, or ctrl-z right after an
        // edit reverts the wrong step. An open group drag is closed first so its step is complete
        flushQueuedPropertyUpdates();
        finishGroupDrag();
        Promise.all([flushPendingAnnotationCommits(), flushPendingFogCommit()]).then(() => {
          if (isRedo) {
            if (client.canRedo) client.redo();
            else addToast({ data: { title: 'Nothing to redo', type: 'info' } });
          } else {
            if (client.canUndo) client.undo();
            else addToast({ data: { title: 'Nothing to undo', type: 'info' } });
          }
        });
        return;
      }
    }

    activeControl = handleKeyCommands(
      event,
      stageProps,
      activeControl,
      stage,
      handleSelectActiveControl,
      clearFogAndRooms,
      aoeKeyCommands
    );
  };

  // Drawing slider handlers - bound from AnnotationManager
  let handleOpacityChange: ((value: number) => void) | undefined = $state();
  let handleBrushSizeChange: ((value: number) => void) | undefined = $state();
  let handleColorChange: ((color: string, opacity: number) => void) | undefined = $state();
  let handleEffectChange: ((effect: AnnotationEffect) => void) | undefined = $state();

  // Tablets get used as editors; background tabs freeze timers and flush them
  // on wake, which would commit stale gesture state into the shared doc long
  // after the fact. Hiding the tab ends any in-flight gesture — commit the
  // still-fresh values now and cancel the timers so nothing fires on wake.
  const commitPendingGestureWrites = () => {
    if (document.visibilityState !== 'hidden') return;
    flushQueuedPropertyUpdates();
    finishGroupDrag();
    for (const [markerId, timer] of dragClearTimers) {
      clearTimeout(timer);
      const position = dragPositions[markerId];
      if (position) {
        session.client?.write.setMarkerFields(selectedSceneId, markerId, {
          positionX: position.x,
          positionY: position.y
        });
      }
    }
    dragClearTimers.clear();
    dragPositions = {};
    flushPendingFogCommit();
    flushPendingAnnotationCommits();
  };

  onMount(() => {
    const element = stageElement;
    let gesture: { start: { x: number; y: number }; sceneId: string; initialIds: string[] } | null = null;
    const cancel = () => {
      gesture = null;
      selectionRectangle = null;
    };
    const start = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        !(event.target instanceof HTMLCanvasElement) ||
        ![MapLayerType.None, MapLayerType.Marker].includes(stageProps.activeLayer)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      gesture = {
        start: { x: event.clientX, y: event.clientY },
        sceneId: selectedSceneId,
        initialIds: [...selectedMarkerIds]
      };
    };
    const move = (event: MouseEvent) => {
      if (!gesture) return;
      if (gesture.sceneId !== selectedSceneId || !event.buttons) {
        cancel();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const bounds = element?.parentElement?.getBoundingClientRect();
      if (!bounds) return;
      const end = { x: event.clientX, y: event.clientY };
      selectionRectangle = {
        x: Math.min(gesture.start.x, end.x) - bounds.left,
        y: Math.min(gesture.start.y, end.y) - bounds.top,
        width: Math.abs(end.x - gesture.start.x),
        height: Math.abs(end.y - gesture.start.y)
      };
    };
    const finish = (event: MouseEvent) => {
      if (!gesture) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (gesture.sceneId === selectedSceneId) {
        const end = { x: event.clientX, y: event.clientY };
        const point = stage?.markers.clientToPosition(end, true);
        if (point) clipboardPointer = { sceneId: selectedSceneId, point };
        if (Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) < 5) {
          const id = stage?.markers.hitTest(end);
          if (id)
            setSelection(
              gesture.initialIds.includes(id)
                ? gesture.initialIds.filter((selected) => selected !== id)
                : [...gesture.initialIds, id]
            );
        } else {
          setSelection([...new Set([...gesture.initialIds, ...stage.markers.inRectangle(gesture.start, end)])]);
        }
      }
      cancel();
    };
    element?.addEventListener('mousedown', start, true);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', finish, true);
    window.addEventListener('blur', cancel);
    return () => {
      element?.removeEventListener('mousedown', start, true);
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', finish, true);
      window.removeEventListener('blur', cancel);
    };
  });

  onMount(() => {
    stagePerformance.init();

    const unbindSleep = session.client ? sleep.bindClient(session.client) : null;
    document.addEventListener('visibilitychange', commitPendingGestureWrites);

    document.addEventListener('copy', handleTokenCopy);
    document.addEventListener('paste', handleTokenPaste);

    if (stageElement) {
      stageElement.addEventListener('mousemove', onMouseMove);
      stageElement.addEventListener('mouseleave', () => {
        isCursorInScene = false;
      });
      stageElement.addEventListener('wheel', onWheel, { passive: false });
      stageElement.addEventListener('contextmenu', (e) => e.preventDefault(), false);
    }

    return () => {
      document.removeEventListener('copy', handleTokenCopy);
      document.removeEventListener('paste', handleTokenPaste);
      document.removeEventListener('visibilitychange', commitPendingGestureWrites);
      if (pendingFogCommit) clearTimeout(pendingFogCommit.timer);
      pendingAnnotationCommits.forEach((pending) => clearTimeout(pending.timer));
      pendingAnnotationCommits.clear();
      dragClearTimers.forEach((timer) => clearTimeout(timer));
      dragClearTimers.clear();
      unbindPropertyUpdates();
      unbindSleep?.();
      sleep.destroy();
      session.destroy();
    };
  });
</script>

<!-- Every new pointer gesture starts a new undo step (capture phase: fires before
     stage/panel handlers write, so the previous capture group closes first) -->
<svelte:document onkeydown={handleKeydown} onpointerdowncapture={() => session.client?.stopCapturing()} />
<svelte:window
  bind:innerWidth
  ondragend={() => (artworkDropTargetId = null)}
  onblur={() => (artworkDropTargetId = null)}
/>
<Head title={gameSession.name} description={`${gameSession.name} on Table Slayer`} />

<div class="container">
  <PaneGroup direction={isMobile ? 'vertical' : 'horizontal'} {onLayoutChange}>
    <Pane
      defaultSize={paneLayout?.[0]?.isCollapsed ? 0 : (paneLayout?.[0]?.size ?? 15)}
      collapsible={true}
      collapsedSize={0}
      minSize={startPaneMinSize}
      maxSize={50}
      bind:this={scenesPane}
      onCollapse={() => {
        isScenesCollapsed = true;
        saveCollapseState();
      }}
      onExpand={() => {
        isScenesCollapsed = false;
        saveCollapseState();
      }}
      onResize={() => {
        if (stage && stageProps.scene.autoFit) {
          stage.scene.fit();
        }
      }}
    >
      <SceneSelector
        {selectedSceneId}
        {gameSession}
        {scenes}
        party={currentParty}
        {activeSceneId}
        client={session.client}
        {isStripeEnabled}
      />
    </Pane>
    <PaneResizer class="resizer">
      <button
        class="resizer__handle"
        aria-label="Collapse scenes column"
        title={isScenesCollapsed ? 'Expand scenes column' : 'Collapse scenes column'}
        onclick={handleToggleScenes}
        ontouchstart={handleToggleScenes}
      >
        <Icon Icon={getCollapseIcon()} />
      </button>
    </PaneResizer>
    <Pane defaultSize={paneLayout?.[1]?.size ?? 70}>
      <div class="stageWrapper" role="presentation">
        {#if stageProps.activeLayer === MapLayerType.Annotation && activeAnnotation && handleOpacityChange && handleBrushSizeChange && handleColorChange}
          <DrawingSliders
            opacity={activeAnnotation.opacity}
            brushSize={stageProps.annotations.lineWidth || 0.5}
            color={activeAnnotation.color}
            currentEffect={activeAnnotation.effect?.type ?? AnnotationEffect.None}
            activeLayerIndex={stageProps.annotations.layers.findIndex(
              (l) => l.id === stageProps.annotations.activeLayer
            ) + 1}
            onOpacityChange={handleOpacityChange}
            onBrushSizeChange={handleBrushSizeChange}
            onColorChange={handleColorChange}
            onEffectChange={handleEffectChange}
            onLayersClick={handleToggleAnnotationPanel}
          />
        {/if}
        {#if stageProps.activeLayer === MapLayerType.FogOfWar && stageProps.fogOfWar.tool.type === ToolType.Brush}
          <FogSliders
            brushSize={stageProps.fogOfWar.tool.size || 2}
            onBrushSizeChange={(size) => {
              queuePropertyUpdate(stageProps, ['fogOfWar', 'tool', 'size'], size, 'control');
              setPreference('brushSizeGridUnits', size);
            }}
          />
        {/if}
        <div
          class={stageClasses}
          bind:this={stageElement}
          role="presentation"
          ondragover={handleCanvasDragOver}
          ondrop={handleCanvasDrop}
          ondragleave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) artworkDropTargetId = null;
          }}
        >
          {#if selectionRectangle}
            <div
              class="tokenSelection__rectangle"
              aria-hidden="true"
              style:left="{selectionRectangle.x}px"
              style:top="{selectionRectangle.y}px"
              style:width="{selectionRectangle.width}px"
              style:height="{selectionRectangle.height}px"
            ></div>
          {/if}
          <PointerInputManager
            {minZoom}
            {maxZoom}
            {zoomSensitivity}
            {stageElement}
            {stageProps}
            mapRotationStep={isMapDefinedMode ? 90 : undefined}
            disableMapZoom={isMapDefinedMode}
            {onMapPan}
            {onMapRotate}
            {onMapZoom}
            {onScenePan}
            {onSceneRotate}
            {onSceneZoom}
          />
          <Stage
            bind:this={stage}
            props={stageProps}
            {selectedMarkerIds}
            dropTargetMarkerId={artworkDropTargetId}
            {activeTurnMarkerId}
            callbacks={{
              onAnnotationUpdate,
              onFogUpdate,
              onFogRoomAdd,
              onFogRoomToggle,
              onFogRoomDelete,
              onMapUpdate,
              onSceneUpdate,
              onStageInitialized,
              onStageLoading,
              onMarkerAdded,
              onMarkerMoved,
              onMarkersMoved,
              onMarkersMoveEnd,
              onMarkerSelected,
              onMarkerDoubleClick,
              onMarkerContextMenu,
              onMarkerHover,
              onLightAdded,
              onLightMoved,
              onLightSelected,
              onMeasurementStart,
              onMeasurementUpdate,
              onMeasurementEnd,
              onAoeTemplateAdded,
              onAoeTemplateUpdated: updateAoeTemplate,
              onAoeTemplateSelected: selectAoeTemplate,
              onAoeTemplateDeleted: removeAoeTemplate,
              onCursorMove: handleCursorMove
            }}
            trackLocalCursor={true}
            hoveredMarkerId={hoveredMarker?.id || null}
            {pinnedMarkerIds}
            {onPinToggle}
            receivedMeasurement={latestMeasurement
              ? {
                  startPoint: latestMeasurement.startPoint,
                  endPoint: latestMeasurement.endPoint,
                  type: latestMeasurement.type,
                  beamWidth: latestMeasurement.beamWidth,
                  coneAngle: latestMeasurement.coneAngle,
                  color: latestMeasurement.color,
                  thickness: latestMeasurement.thickness,
                  outlineColor: latestMeasurement.outlineColor,
                  outlineThickness: latestMeasurement.outlineThickness,
                  opacity: latestMeasurement.opacity,
                  markerSize: latestMeasurement.markerSize,
                  autoHideDelay: latestMeasurement.autoHideDelay,
                  fadeoutTime: latestMeasurement.fadeoutTime,
                  showDistance: latestMeasurement.showDistance,
                  snapToGrid: latestMeasurement.snapToGrid,
                  enableDMG252: latestMeasurement.enableDMG252
                }
              : null}
          />
          <PerformanceDebugger />
          {#if tokenPanel && tokenPanelMarker}
            <TokenContextPanel
              name={tokenPanelMarker.title || tokenPanelMarker.label || 'Token'}
              targetCount={selectedMarkerIds.length}
              position={{ x: tokenPanel.x, y: tokenPanel.y }}
              conditions={conditionPickerFor(selectedMarkerIds)}
              visibility={selectedMarkerIds.length === 1 ? tokenPanelMarker.visibility : undefined}
              onVisibilityChange={(visibility) =>
                selectedMarkerIds.forEach((id) => setMarkerVisibility(id, visibility))}
              pinned={pinnedMarkerIds.includes(tokenPanelMarker.id)}
              onPinToggle={tokenPanelMarker.visibility === MarkerVisibility.DM
                ? undefined
                : (pinned) => onPinToggle(tokenPanelMarker.id, pinned)}
              onShowAsHandout={canPresentHandouts && selectedMarkerIds.length === 1
                ? () => previewTokenHandout(tokenPanelMarker.id)
                : undefined}
              onSaveToLibrary={canEditAssets && selectedMarkerIds.length === 1
                ? () => saveTokenToLibrary(tokenPanelMarker.id)
                : undefined}
              combatState={combatRunning ? 'running' : 'none'}
              {targetsInCombat}
              onCombatAction={handleTokenCombatAction}
              onDelete={deleteTokenPanelTargets}
              onClose={() => (tokenPanel = null)}
            />
          {/if}
        </div>
        <SceneControls
          {stageProps}
          {stage}
          {handleMapFill}
          {handleMapFit}
          selectedScene={selectedSceneForControls}
          {activeSceneId}
          {handleSelectActiveControl}
          {activeControl}
          party={currentParty}
          {gameSession}
          client={session.client}
          isCompact={isMobile}
          onFogClear={clearFogAndRooms}
          aoeTool={stageProps.aoeTemplates?.tool}
          onAoeToolChange={changeAoeTool}
        />
        <SceneZoom {stage} {handleSceneFit} {handleMapFill} {stageProps} />
        <Shortcuts />
        <ChecklistHelpButton onclick={handleShowChecklist} />
        <HandoutLivePill partyId={party.id} client={session.client} onOpen={() => openSidePanelTab('handout')} />
        {#if catalogOpen}
          <AssetCatalogOverlay
            onClose={() => (catalogOpen = false)}
            onPlace={(assetId) => placeAssetAt(assetId, 1, getViewportCenter() ?? { x: 0, y: 0 })}
          />
        {/if}
        <Hints {stageProps} />
        {#if quickCardRow?.statBlock}
          <StatBlockQuickCard
            statBlock={quickCardRow.statBlock}
            hitPoints={quickCardRow.hitPoints ?? null}
            tempHitPoints={quickCardRow.tempHitPoints ?? null}
            collapsed={statBlockQuickCardCollapsed}
            onCollapsedChange={setQuickCardCollapsed}
            onHitPointsChange={(fields) => writeHitPoints(quickCardRow.id, fields)}
            onRoll={onStatRoll}
            onOpenFullStatBlock={() => openFullStatBlock(quickCardRow.id)}
          />
        {/if}
      </div>
    </Pane>
    <PaneResizer class="resizer">
      <button
        class="resizer__handle"
        aria-label="Collapse scenes column"
        title={isMarkersCollapsed ? 'Expand markers column' : 'Collapse markers column'}
        onclick={handleToggleMarkers}
        ontouchstart={handleToggleMarkers}
      >
        <Icon Icon={getMarkerCollapseIcon()} />
      </button>
    </PaneResizer>
    <Pane
      defaultSize={paneLayout?.[2]?.isCollapsed ? 0 : (paneLayout?.[2]?.size ?? 25)}
      collapsible={true}
      collapsedSize={0}
      minSize={endPaneMinSize}
      maxSize={50}
      bind:this={markersPane}
      onCollapse={() => {
        isMarkersCollapsed = true;
        saveCollapseState();
      }}
      onExpand={() => {
        isMarkersCollapsed = false;
        saveCollapseState();
      }}
      onResize={() => {
        if (stage && stageProps.scene.autoFit) {
          stage.scene.fit();
        }
      }}
    >
      <div class="editor-tools">
        <SidePanelTabs
          selected={sidePanelTab}
          onSelect={(tab) => (sidePanelTab = tab)}
          handoutLive={!!liveHandout}
          combatLive={combatRunning}
          showLibrary={canEditAssets}
          showHandout={canPresentHandouts}
        />
        <div
          class="editor-tools__content"
          id="sidePanel-tokens"
          role="tabpanel"
          aria-labelledby="sidePanelTab-tokens"
          hidden={sidePanelTab !== 'tokens'}
        >
          {#if activeControl === 'aoe' && stageProps.aoeTemplates}
            <AoeTemplateManager
              templates={stageProps.aoeTemplates.templates}
              selectedId={stageProps.aoeTemplates.selectedId}
              onSelect={selectAoeTemplate}
              onUpdate={updateAoeTemplate}
              onDelete={removeAoeTemplate}
              onActivateTool={() => handleSelectActiveControl('aoe', { toggle: false })}
              isToolActive={activeControl === 'aoe'}
            />
          {:else if activeControl === 'annotation'}
            {#key selectedAnnotationId}
              <AnnotationManager
                {stageProps}
                bind:selectedAnnotationId
                {onAnnotationDeleted}
                {onAnnotationUpdated}
                {onAnnotationCreated}
                bind:handleOpacityChange
                bind:handleBrushSizeChange
                bind:handleColorChange
                bind:handleEffectChange
                annotationMasks={data.selectedSceneAnnotationMasks}
                smoothingEnabled={stageProps.annotations.smoothingEnabled}
                onSmoothingChange={(enabled) => {
                  stageProps.annotations.smoothingEnabled = enabled;
                  setPreference('annotationSmoothing', enabled);
                }}
              />
            {/key}
          {:else if activeControl === 'light'}
            {#key selectedLightId}
              <LightManager
                partyId={party.id}
                sceneId={selectedSceneId}
                {stageProps}
                bind:selectedLightId
                {handleSelectActiveControl}
                {updateLightAndSave}
                {onLightDeleted}
              />
            {/key}
          {:else if showChecklist}
            <Checklist
              completedItems={checklistCompletedItems}
              onComplete={handleChecklistItemComplete}
              onDismiss={handleChecklistDismiss}
            />
          {:else if !isMarkersCollapsed}
            <MarkerManager
              partyId={party.id}
              {stageProps}
              bind:selectedMarkerId
              {selectedMarkerIds}
              onSelectionChange={setSelection}
              {handleSelectActiveControl}
              {updateMarkerAndSave}
              onArtworkFile={replaceTokenArtwork}
              onHandoutPreview={canPresentHandouts ? previewTokenHandout : undefined}
              {onMarkerDeleted}
              {pinnedMarkerIds}
              {onPinToggle}
              conditionPickerFor={(markerId) => conditionPickerFor([markerId])}
              {statBlockFor}
              onHitPointsChange={writeHitPoints}
              {onStatRoll}
              sceneId={selectedSceneId}
              onNoteSave={(sceneId, markerId, note) =>
                session.client?.write.setExistingMarkerFields(sceneId, markerId, { note })}
            />
          {/if}
        </div>
        <div
          class="editor-tools__content"
          id="sidePanel-library"
          role="tabpanel"
          aria-labelledby="sidePanelTab-library"
          hidden={sidePanelTab !== 'library'}
        >
          <AssetLibrary
            client={session.client}
            sceneId={selectedSceneId}
            {selectedMarkerId}
            bucketUrl={data.bucketUrl}
            onPreviewArtwork={canPresentHandouts ? previewAssetHandout : undefined}
            onOpenCatalog={() => (catalogOpen = true)}
            bind:quantity={libraryQuantity}
            {getViewportCenter}
            snapPosition={snapPlacement}
          />
        </div>
        <div
          class="editor-tools__content"
          id="sidePanel-handout"
          role="tabpanel"
          aria-labelledby="sidePanelTab-handout"
          hidden={sidePanelTab !== 'handout'}
        >
          {#if canPresentHandouts}
            <HandoutPanel
              partyId={party.id}
              client={session.client}
              bucketUrl={data.bucketUrl}
              preview={handoutPreview}
              onPreviewChange={(preview) => (handoutPreview = preview)}
            />
          {/if}
        </div>
        <div
          class="editor-tools__content"
          id="sidePanel-combat"
          role="tabpanel"
          aria-labelledby="sidePanelTab-combat"
          hidden={sidePanelTab !== 'combat'}
        >
          <InitiativeTracker
            {combatants}
            position={turnPosition}
            lairActions={combatSnapshot?.settings.combatLairActions ?? false}
            showOnTv={combatSnapshot?.settings.combatShowOnTv ?? true}
            {selectedMarkerIds}
            bucketUrl={data.bucketUrl}
            onAction={handleCombatAction}
            onSelectMarker={(id) => {
              selectedMarkerId = id;
              setSelection([id]);
            }}
            onBonusChange={onInitiativeBonusChange}
            onSettingsChange={(fields) => session.client?.systemWrite.setSceneSettings(selectedSceneId, fields)}
          />
        </div>
      </div>
    </Pane>
  </PaneGroup>
</div>

<style>
  .editor-tools {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .editor-tools__content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .editor-tools__content[hidden] {
    display: none;
  }
  .tokenSelection__rectangle {
    position: absolute;
    border: 1px solid var(--fgPrimary);
    background: color-mix(in srgb, var(--fgPrimary) 15%, transparent);
    pointer-events: none;
    z-index: 20;
  }
  :global {
    .panel.scene {
      aspect-ratio: 16 / 9;
    }
    /* Don't change container-name */
    /* Container is globally checked in child components */
    .stageWrapper {
      container-name: stageWrapper;
      container-type: size;
      display: flex;
      align-items: center;
      background: var(--contrastEmpty);
      height: 100%;
      position: relative;
    }
    .resizer {
      position: relative;
      display: flex;
      width: 1rem;
      z-index: 2;
      background: var(--contrastEmpty);
    }
    .resizer__handle {
      width: 100%;
      height: 2rem;
      cursor: col-resize;
      background: var(--contrastMedium);
      margin-top: 1rem;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      z-index: 1;
    }
    .resizer:hover .resizer__handle {
      background: var(--fg);
      color: var(--bg);
    }
    .resizer__handle--left {
      position: relative;
      transform: translateX(-0.25rem);
    }
    .resizer__handle--right {
      position: relative;
      transform: translateX(0.25rem);
    }
    .controls {
      border-left: var(--borderThin);
      background: var(--bg);
    }

    @media (max-width: 768px) {
      .resizer {
        width: 100% !important;
        height: 2rem !important;
        cursor: row-resize;
      }
      .resizer__handle {
        width: 4rem !important;
        height: 100% !important;
        cursor: pointer;
        margin-left: 50%;
        transform: translateX(-50%);
        margin-top: 0 !important;
      }
    }
  }
  .container {
    height: calc(100dvh - 43px);
    user-select: none;
  }
  .stage {
    width: 100%;
    height: 100%;
    opacity: 1;
    visibility: visible;
    transition: opacity 0.25s ease-in;
  }
  .stage.stage--loading {
    visibility: hidden;
    opacity: 0;
  }
  .stage.stage--hideCursor {
    cursor: none;
  }
  .stage.stage--crosshairCursor {
    cursor: crosshair;
  }
  .stage.stage--pointerCursor {
    cursor: pointer;
  }
  .stage.stage--grabbingCursor {
    cursor: grabbing;
  }
</style>
