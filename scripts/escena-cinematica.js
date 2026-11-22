/**
 * Escena Cinemática a Pantalla Completa (Dorso Oscuro) — Foundry VTT v12 / v13 / v14
 *
 * Características:
 * 1. Permite activar cualquier escena en "Modo Pantalla Completa" con un fundido a negro (fade) configurable.
 * 2. Oculta toda la interfaz de Foundry (incluyendo las cámaras WebRTC / A/V Dock sin cortar la voz) para los
 *    jugadores y ajusta automáticamente la escala de la escena a la resolución del monitor de cada jugador en
 *    dos modos configurables:
 *    - "contain" (Completo): muestra el 100% de la escena sin recortar nada.
 *    - "cover"   (Rellenar): llena el 100% de la ventana del navegador sin bandas.
 * 3. Interacción narrativa: bloquea el arrastre/movimiento libre y la selección de tokens, permitiendo
 *    únicamente hacer zoom con la rueda del ratón (con encuadre inteligente dentro de los límites de la escena
 *    y retorno automático al centro al alejar el zoom).
 * 4. Vista del GM: previsualiza la pantalla completa igual que los jugadores (también sin cámaras), pliega
 *    automáticamente la barra lateral derecha (dejándola disponible por si necesita abrir chat, audio o diario)
 *    y muestra una barra flotante superior para alternar entre "Completo"/"Rellenar" o "Volver a Modo Normal".
 */

const MODULE_ID = "dorso-escena-cinematica";
const SOCKET_NAME = `module.${MODULE_ID}`;

const runtimeState = {
    isCinematic: false,
    sceneId: null,
    fitMode: "contain",
    baseScale: 1,
    sceneBounds: null,
    lastTimestamp: 0,
    isTransitioning: false
};

/* ==========================================================================
   1. UTILIDADES DE CONFIGURACIÓN Y OVERLAY DE FUNDIDO (FADE)
   ========================================================================== */

function getFadeMs() {
    try {
        const sec = Number(game.settings.get(MODULE_ID, "fadeDuration") ?? 2);
        return Math.max(0, Math.min(15000, Math.round(sec * 1000)));
    } catch (e) {
        return 2000;
    }
}

function getDefaultFitMode() {
    try {
        return game.settings.get(MODULE_ID, "defaultFitMode") || "contain";
    } catch (e) {
        return "contain";
    }
}

function getCinematicStateSetting() {
    try {
        return game.settings.get(MODULE_ID, "cinematicState") || { active: false };
    } catch (e) {
        return { active: false };
    }
}

function ensureFadeOverlay() {
    let overlay = document.getElementById("dec-fade-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "dec-fade-overlay";
        document.body.appendChild(overlay);
    }
    return overlay;
}

function setFadeOverlayDuration(ms) {
    document.documentElement.style.setProperty("--dec-fade-ms", `${ms}ms`);
    const overlay = ensureFadeOverlay();
    overlay.style.transitionDuration = `${ms}ms`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fadeInBlack(durationMs) {
    const overlay = ensureFadeOverlay();
    setFadeOverlayDuration(durationMs);
    void overlay.offsetWidth;
    overlay.classList.add("dec-fade-visible");
    if (durationMs > 0) {
        await sleep(durationMs);
    }
}

async function fadeOutBlack(durationMs) {
    const overlay = ensureFadeOverlay();
    setFadeOverlayDuration(durationMs);
    void overlay.offsetWidth;
    overlay.classList.remove("dec-fade-visible");
    if (durationMs > 0) {
        await sleep(durationMs);
    }
}

/* ==========================================================================
   2. CÁLCULO DE ENCUADRE AL MONITOR DE CADA JUGADOR (COMPLETO vs RELLENAR)
   ========================================================================== */

function computeSceneBounds() {
    if (!canvas || !canvas.ready || !canvas.dimensions) return null;
    const d = canvas.dimensions;

    const sceneX = Number.isFinite(d.sceneX) ? d.sceneX : (d.rect?.x ?? 0);
    const sceneY = Number.isFinite(d.sceneY) ? d.sceneY : (d.rect?.y ?? 0);
    const sceneW = Number.isFinite(d.sceneWidth) && d.sceneWidth > 0 ? d.sceneWidth : (d.width || 1920);
    const sceneH = Number.isFinite(d.sceneHeight) && d.sceneHeight > 0 ? d.sceneHeight : (d.height || 1080);

    return {
        x: sceneX,
        y: sceneY,
        width: sceneW,
        height: sceneH,
        centerX: sceneX + (sceneW / 2),
        centerY: sceneY + (sceneH / 2)
    };
}

function computeOptimalScale(bounds, fitMode = "contain") {
    if (!bounds) return 1;
    const viewW = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1920);
    const viewH = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 1080);

    const scaleX = viewW / bounds.width;
    const scaleY = viewH / bounds.height;

    const rawScale = fitMode === "cover"
        ? Math.max(scaleX, scaleY)
        : Math.min(scaleX, scaleY);

    return Math.max(0.05, Math.min(10, rawScale));
}

function ensureCanvasScaleLimits(targetScale) {
    if (!canvas?.stage) return;
    try {
        if (CONFIG?.Canvas && typeof CONFIG.Canvas.minZoom === "number") {
            if (targetScale < CONFIG.Canvas.minZoom) {
                CONFIG.Canvas.minZoom = Math.min(CONFIG.Canvas.minZoom, targetScale * 0.85);
            }
        }
    } catch (e) {}
}

export async function fitSceneToViewport(fitMode = runtimeState.fitMode, animate = false) {
    if (!canvas || !canvas.ready) return;
    const bounds = computeSceneBounds();
    if (!bounds) return;

    const scale = computeOptimalScale(bounds, fitMode);
    runtimeState.sceneBounds = bounds;
    runtimeState.baseScale = scale;
    runtimeState.fitMode = fitMode;

    ensureCanvasScaleLimits(scale);

    try {
        if (animate && canvas.animatePan) {
            await canvas.animatePan({
                x: bounds.centerX,
                y: bounds.centerY,
                scale: scale,
                duration: 280
            });
        } else {
            canvas.pan({
                x: bounds.centerX,
                y: bounds.centerY,
                scale: scale
            });
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | Error al ajustar cámara a pantalla completa:`, e);
    }
}

/* ==========================================================================
   3. HUD FLOTANTE PARA EL GM (PREVISUALIZACIÓN Y RETORNO A MODO NORMAL)
   ========================================================================== */

function renderGMFloatingHud() {
    removeGMFloatingHud();
    if (!game.user?.isGM || !runtimeState.isCinematic) return;

    const scene = game.scenes?.get(runtimeState.sceneId) || canvas?.scene;
    const sceneName = scene?.name || "Escena Activa";
    const isCover = runtimeState.fitMode === "cover";
    const fitLabel = isCover ? "Rellenar (Cover)" : "Completo (Contain)";
    const fitIcon = isCover ? "fa-solid fa-up-right-and-down-left-from-center" : "fa-solid fa-compress";

    const hud = document.createElement("div");
    hud.id = "dec-gm-hud";
    hud.innerHTML = `
        <span class="dec-hud-badge" title="Los jugadores están viendo esta escena en Modo Pantalla Completa sin interfaz ni cámaras">
            <i class="fa-solid fa-circle"></i>
            <span>Pantalla Completa</span>
        </span>
        <span class="dec-hud-scene-name" title="${sceneName}">${sceneName}</span>
        <button type="button" class="dec-hud-btn" data-action="toggle-fit" title="Alternar entre Completo (ver toda la escena) y Rellenar (ocupar todo el monitor)">
            <i class="${fitIcon}"></i>
            <span>Ajuste: ${fitLabel}</span>
        </button>
        <button type="button" class="dec-hud-btn" data-action="recenter" title="Restablecer y centrar el zoom en todos los monitores">
            <i class="fa-solid fa-crosshairs"></i>
            <span>Centrar</span>
        </button>
        <button type="button" class="dec-hud-btn dec-hud-btn-exit" data-action="exit-cinematic" title="Desactivar el modo pantalla completa y devolver a todos los jugadores al Modo Normal">
            <i class="fa-solid fa-right-from-bracket"></i>
            <span>Volver a Modo Normal</span>
        </button>
    `;

    hud.querySelector('[data-action="toggle-fit"]')?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const nextMode = runtimeState.fitMode === "cover" ? "contain" : "cover";
        await updateGlobalCinematicState({
            active: true,
            sceneId: runtimeState.sceneId || canvas?.scene?.id,
            fitMode: nextMode,
            fadeMs: 0,
            action: "updateFit"
        });
    });

    hud.querySelector('[data-action="recenter"]')?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        await updateGlobalCinematicState({
            active: true,
            sceneId: runtimeState.sceneId || canvas?.scene?.id,
            fitMode: runtimeState.fitMode,
            fadeMs: 0,
            action: "recenter"
        });
    });

    hud.querySelector('[data-action="exit-cinematic"]')?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        await deactivateCinematicMode();
    });

    document.body.appendChild(hud);
}

function removeGMFloatingHud() {
    document.getElementById("dec-gm-hud")?.remove();
}

/* ==========================================================================
   4. TRANSICIÓN DE ENTRADA Y SALIDA DEL MODO PANTALLA COMPLETA
   ========================================================================== */

function applyBodyCinematicClasses(active) {
    if (active) {
        document.body.classList.add("dec-cinematic-active");
        document.body.classList.toggle("dec-is-gm", Boolean(game.user?.isGM));
        document.body.classList.toggle("dec-is-player", !game.user?.isGM);
    } else {
        document.body.classList.remove("dec-cinematic-active", "dec-is-gm", "dec-is-player");
    }
}

function collapseGMSidebarSafely() {
    if (!game.user?.isGM) return;
    try {
        if (ui.sidebar && typeof ui.sidebar.collapse === "function") {
            ui.sidebar.collapse();
        }
    } catch (e) {}
}

async function waitForSceneCanvasReady(targetSceneId, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (canvas?.ready && (!targetSceneId || canvas.scene?.id === targetSceneId)) {
            return true;
        }
        await sleep(60);
    }
    return Boolean(canvas?.ready);
}

async function applyLocalCinematicMode(payload) {
    const {
        active,
        sceneId,
        fitMode = getDefaultFitMode(),
        fadeMs = getFadeMs(),
        action = "enter"
    } = payload || {};

    if (active && runtimeState.isCinematic && (action === "updateFit" || action === "recenter")) {
        runtimeState.fitMode = fitMode;
        await fitSceneToViewport(fitMode, true);
        renderGMFloatingHud();
        return;
    }

    if (active) {
        if (runtimeState.isTransitioning) return;
        runtimeState.isTransitioning = true;

        try {
            const entryFadeMs = Math.max(150, Math.round(fadeMs * 0.45));
            const revealFadeMs = Math.max(200, Number(fadeMs));

            await fadeInBlack(entryFadeMs);

            runtimeState.isCinematic = true;
            runtimeState.sceneId = sceneId || canvas?.scene?.id || null;
            runtimeState.fitMode = fitMode;

            // Ocultar UI y cámaras de Foundry y plegar barra derecha del GM
            applyBodyCinematicClasses(true);
            collapseGMSidebarSafely();

            await waitForSceneCanvasReady(runtimeState.sceneId);
            await sleep(80);

            await fitSceneToViewport(fitMode, false);

            renderGMFloatingHud();
            refreshDirectoryButtonsState();

            await fadeOutBlack(revealFadeMs);
        } finally {
            runtimeState.isTransitioning = false;
        }
    } else {
        if (!runtimeState.isCinematic && !document.body.classList.contains("dec-cinematic-active")) {
            return;
        }
        if (runtimeState.isTransitioning) return;
        runtimeState.isTransitioning = true;

        try {
            const exitFadeMs = Math.max(250, Math.round(fadeMs * 0.5));
            await fadeInBlack(exitFadeMs);

            runtimeState.isCinematic = false;
            runtimeState.sceneId = null;

            removeGMFloatingHud();
            applyBodyCinematicClasses(false);
            refreshDirectoryButtonsState();

            await sleep(80);
            await fadeOutBlack(exitFadeMs);
        } finally {
            runtimeState.isTransitioning = false;
        }
    }
}

/* ==========================================================================
   5. SINCRONIZACIÓN GM -> JUGADORES (SETTING DE MUNDO + SOCKET)
   ========================================================================== */

async function updateGlobalCinematicState(newState) {
    if (!game.user?.isGM) return;

    const payload = {
        active: Boolean(newState.active),
        sceneId: newState.sceneId || canvas?.scene?.id || null,
        fitMode: newState.fitMode || getDefaultFitMode(),
        fadeMs: typeof newState.fadeMs === "number" ? newState.fadeMs : getFadeMs(),
        action: newState.action || (newState.active ? "enter" : "exit"),
        timestamp: Date.now()
    };

    runtimeState.lastTimestamp = payload.timestamp;

    try {
        game.socket?.emit(SOCKET_NAME, payload);
    } catch (e) {}

    try {
        await game.settings.set(MODULE_ID, "cinematicState", payload);
    } catch (e) {}

    await applyLocalCinematicMode(payload);
}

/**
 * Activa una escena en Modo Pantalla Completa para todos los jugadores y el GM.
 */
export async function activateSceneInCinematicMode(sceneOrId = null, options = {}) {
    if (!game.user?.isGM) {
        ui.notifications?.warn("Solo el Director de Juego puede activar el Modo Pantalla Completa.");
        return;
    }

    const scene = typeof sceneOrId === "string"
        ? game.scenes?.get(sceneOrId)
        : (sceneOrId || canvas?.scene);

    if (!scene) {
        ui.notifications?.warn("No se ha encontrado la escena para activar en Pantalla Completa.");
        return;
    }

    const fitMode = options.fitMode || getDefaultFitMode();
    const fadeMs = typeof options.fadeMs === "number" ? options.fadeMs : getFadeMs();

    const payload = {
        active: true,
        sceneId: scene.id,
        fitMode,
        fadeMs,
        action: "enter",
        timestamp: Date.now()
    };

    runtimeState.lastTimestamp = payload.timestamp;

    try {
        game.socket?.emit(SOCKET_NAME, payload);
    } catch (e) {}

    try {
        await game.settings.set(MODULE_ID, "cinematicState", payload);
    } catch (e) {}

    const transitionPromise = applyLocalCinematicMode(payload);

    if (!scene.active) {
        await scene.activate();
    } else if (canvas?.scene?.id !== scene.id) {
        await scene.view();
    }

    await transitionPromise;
}

/**
 * Sale del Modo Pantalla Completa y devuelve a todos los jugadores al Modo Normal.
 */
export async function deactivateCinematicMode(options = {}) {
    if (!game.user?.isGM) return;

    const fadeMs = typeof options.fadeMs === "number" ? options.fadeMs : getFadeMs();
    await updateGlobalCinematicState({
        active: false,
        sceneId: null,
        fitMode: runtimeState.fitMode,
        fadeMs,
        action: "exit"
    });
}

export async function toggleCinematicModeOnCurrentScene(options = {}) {
    if (runtimeState.isCinematic) {
        await deactivateCinematicMode(options);
    } else if (canvas?.scene) {
        await activateSceneInCinematicMode(canvas.scene, options);
    }
}

function handleIncomingCinematicPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.timestamp && payload.timestamp <= runtimeState.lastTimestamp) return;
    runtimeState.lastTimestamp = payload.timestamp || Date.now();
    applyLocalCinematicMode(payload);
}

/* ==========================================================================
   6. CONTROL DE CÁMARA NARRATIVA (SOLO ZOOM PERMITIDO + BLOQUEO DE ARRASTRE)
   ========================================================================== */

function setupNarrativeZoomAndInteractionLocks() {
    window.addEventListener("wheel", (ev) => {
        if (!runtimeState.isCinematic || !canvas?.ready) return;

        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("#ui-right, #sidebar, .app, .application, #dec-gm-hud")) return;
        if (target.id !== "board" && !target.closest("#board")) return;

        ev.preventDefault();
        ev.stopImmediatePropagation();

        const bounds = runtimeState.sceneBounds || computeSceneBounds();
        if (!bounds) return;

        const minScale = runtimeState.baseScale || computeOptimalScale(bounds, runtimeState.fitMode);
        const maxScale = Math.max(minScale * 4.5, 3.0);
        const currentScale = canvas.stage?.scale?.x || minScale;

        const zoomFactor = ev.deltaY < 0 ? 1.12 : (1 / 1.12);
        const nextScale = Math.max(minScale, Math.min(maxScale, currentScale * zoomFactor));

        if (nextScale <= minScale * 1.02) {
            canvas.pan({
                x: bounds.centerX,
                y: bounds.centerY,
                scale: minScale
            });
            return;
        }

        const rect = target.getBoundingClientRect();
        const screenX = ev.clientX - rect.left;
        const screenY = ev.clientY - rect.top;
        const viewCenterX = rect.width / 2;
        const viewCenterY = rect.height / 2;

        const currentCenterX = canvas.stage.pivot.x;
        const currentCenterY = canvas.stage.pivot.y;

        let nextCenterX = currentCenterX;
        let nextCenterY = currentCenterY;

        if (ev.deltaY < 0) {
            const worldMouseX = currentCenterX + ((screenX - viewCenterX) / currentScale);
            const worldMouseY = currentCenterY + ((screenY - viewCenterY) / currentScale);
            nextCenterX = worldMouseX - ((screenX - viewCenterX) / nextScale);
            nextCenterY = worldMouseY - ((screenY - viewCenterY) / nextScale);
        } else {
            const ratio = (nextScale - minScale) / Math.max(0.0001, currentScale - minScale);
            nextCenterX = bounds.centerX + (currentCenterX - bounds.centerX) * ratio;
            nextCenterY = bounds.centerY + (currentCenterY - bounds.centerY) * ratio;
        }

        const halfVisibleW = (rect.width / nextScale) / 2;
        const halfVisibleH = (rect.height / nextScale) / 2;

        const minX = bounds.x + Math.min(bounds.width / 2, halfVisibleW);
        const maxX = (bounds.x + bounds.width) - Math.min(bounds.width / 2, halfVisibleW);
        const minY = bounds.y + Math.min(bounds.height / 2, halfVisibleH);
        const maxY = (bounds.y + bounds.height) - Math.min(bounds.height / 2, halfVisibleH);

        const clampedX = Math.max(minX, Math.min(maxX, nextCenterX));
        const clampedY = Math.max(minY, Math.min(maxY, nextCenterY));

        canvas.pan({
            x: clampedX,
            y: clampedY,
            scale: nextScale
        });
    }, { capture: true, passive: false });

    const blockBoardMouseInteraction = (ev) => {
        if (!runtimeState.isCinematic) return;
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.id !== "board" && !target.closest("#board")) return;

        ev.preventDefault();
        ev.stopImmediatePropagation();
    };

    window.addEventListener("pointerdown", blockBoardMouseInteraction, { capture: true });
    window.addEventListener("mousedown", blockBoardMouseInteraction, { capture: true });
    window.addEventListener("contextmenu", (ev) => {
        if (!runtimeState.isCinematic) return;
        const target = ev.target;
        if (target instanceof HTMLElement && (target.id === "board" || target.closest("#board"))) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
        }
    }, { capture: true });

    let resizeTimeout = null;
    window.addEventListener("resize", () => {
        if (!runtimeState.isCinematic) return;
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            fitSceneToViewport(runtimeState.fitMode, false);
        }, 120);
    });
}

/* ==========================================================================
   7. INTEGRACIÓN CON MENÚ CONTEXTUAL (CLIC DERECHO) Y DIRECTORIO EN FOUNDRY V14
   ========================================================================== */

/**
 * Extrae el ID de una escena a partir de cualquier elemento del DOM (barra superior #navigation / #scene-navigation
 * o panel lateral #scenes en Foundry v12, v13 y v14 ApplicationV2).
 */
function resolveSceneIdFromElement(target) {
    const el = target instanceof HTMLElement ? target : target?.[0];
    if (!el) return null;

    const item = el.closest("[data-scene-id], [data-document-id], [data-entry-id]");
    if (!item) return null;

    const candidateId = item.dataset.sceneId || item.dataset.documentId || item.dataset.entryId;
    if (!candidateId) return null;

    // Verificar que realmente corresponde a una escena existente en game.scenes
    if (game.scenes?.has?.(candidateId) || game.scenes?.get?.(candidateId)) {
        return candidateId;
    }
    return null;
}

function buildSceneContextMenuItems() {
    return [
        {
            name: "Activar en Pantalla Completa",
            icon: '<i class="fa-solid fa-expand" style="color:#f3d292;"></i>',
            condition: () => Boolean(game.user?.isGM),
            callback: (li) => {
                const sceneId = resolveSceneIdFromElement(li);
                if (sceneId) activateSceneInCinematicMode(sceneId, { fitMode: getDefaultFitMode() });
            }
        },
        {
            name: "Pantalla Completa (Modo Completo)",
            icon: '<i class="fa-solid fa-compress" style="color:#38bdf8;"></i>',
            condition: () => Boolean(game.user?.isGM),
            callback: (li) => {
                const sceneId = resolveSceneIdFromElement(li);
                if (sceneId) activateSceneInCinematicMode(sceneId, { fitMode: "contain" });
            }
        },
        {
            name: "Pantalla Completa (Modo Rellenar)",
            icon: '<i class="fa-solid fa-up-right-and-down-left-from-center" style="color:#a855f7;"></i>',
            condition: () => Boolean(game.user?.isGM),
            callback: (li) => {
                const sceneId = resolveSceneIdFromElement(li);
                if (sceneId) activateSceneInCinematicMode(sceneId, { fitMode: "cover" });
            }
        },
        {
            name: "Volver a Modo Normal",
            icon: '<i class="fa-solid fa-right-from-bracket" style="color:#f87171;"></i>',
            condition: () => Boolean(game.user?.isGM && runtimeState.isCinematic),
            callback: () => {
                deactivateCinematicMode();
            }
        }
    ];
}

function injectSceneContextOptions(appOrHtml, menuItems) {
    if (!game.user?.isGM || !Array.isArray(menuItems)) return;
    if (menuItems.some(i => i.name?.includes("Pantalla Completa"))) return;

    const customItems = buildSceneContextMenuItems();
    const activateIdx = menuItems.findIndex(i =>
        i.name?.includes("Activate") || i.name?.includes("Activar") || i.name?.includes("SCENE.Activate")
    );
    if (activateIdx >= 0) {
        menuItems.splice(activateIdx + 1, 0, ...customItems);
    } else {
        menuItems.unshift(...customItems);
    }
}

/**
 * Inyecta en cualquier menú contextual de Foundry (tanto <ol class="context-items"> en v12
 * como <menu class="context-items"> en v13/v14 ApplicationV2) las opciones de Pantalla Completa.
 */
function injectCinematicOptionsIntoOpenContextMenu(sceneId) {
    if (!game.user?.isGM || !sceneId) return;

    const ctxLists = document.querySelectorAll(
        "#context-menu .context-items, .context-menu .context-items, #context-menu menu, #context-menu ol"
    );

    ctxLists.forEach(ctxMenu => {
        if (ctxMenu.querySelector(".dec-injected-ctx")) return;
        if (ctxMenu.textContent?.includes("Pantalla Completa")) return;

        const createCtxItem = (html, onClick) => {
            const li = document.createElement("li");
            li.className = "context-item dec-injected-ctx";
            li.innerHTML = html;
            li.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll("#context-menu, .context-menu").forEach(m => m.remove());
                onClick();
            });
            return li;
        };

        const itemsToInsert = [
            createCtxItem(
                `<i class="fa-solid fa-expand fa-fw" style="color:#f3d292;"></i> <span>Activar en Pantalla Completa</span>`,
                () => activateSceneInCinematicMode(sceneId, { fitMode: getDefaultFitMode() })
            ),
            createCtxItem(
                `<i class="fa-solid fa-compress fa-fw" style="color:#38bdf8;"></i> <span>Pantalla Completa (Completo)</span>`,
                () => activateSceneInCinematicMode(sceneId, { fitMode: "contain" })
            ),
            createCtxItem(
                `<i class="fa-solid fa-up-right-and-down-left-from-center fa-fw" style="color:#a855f7;"></i> <span>Pantalla Completa (Rellenar)</span>`,
                () => activateSceneInCinematicMode(sceneId, { fitMode: "cover" })
            )
        ];

        if (runtimeState.isCinematic) {
            itemsToInsert.push(
                createCtxItem(
                    `<i class="fa-solid fa-right-from-bracket fa-fw" style="color:#f87171;"></i> <span>Volver a Modo Normal</span>`,
                    () => deactivateCinematicMode()
                )
            );
        }

        // Buscar el item "Activar" / "Activate" para colocar nuestras opciones justo debajo
        const children = Array.from(ctxMenu.children);
        const activateLi = children.find(li => {
            const txt = (li.textContent || "").toLowerCase();
            return txt.includes("activar") || txt.includes("activate");
        });

        if (activateLi && activateLi.nextSibling) {
            const refNode = activateLi.nextSibling;
            itemsToInsert.forEach(item => ctxMenu.insertBefore(item, refNode));
        } else if (activateLi) {
            itemsToInsert.forEach(item => ctxMenu.appendChild(item));
        } else {
            itemsToInsert.reverse().forEach(item => ctxMenu.prepend(item));
        }
    });
}

/**
 * Listener global delegado para clic derecho (contextmenu) en toda la interfaz de Foundry v14:
 * Funciona tanto en la barra de navegación superior (#navigation / #scene-navigation) como en el
 * Directorio de Escenas de la barra derecha (#scenes), sin importar cómo o cuándo se hayan renderizado.
 */
function setupGlobalSceneContextMenuInterceptor() {
    document.addEventListener("contextmenu", (ev) => {
        if (!game.user?.isGM) return;
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;

        // Comprobar si el clic derecho ha ocurrido sobre una escena (en Navegación o en Directorio de Escenas)
        const inSceneArea = target.closest(
            "#scenes, .scenes-sidebar, [data-tab='scenes'], #navigation, #scene-navigation"
        );
        if (!inSceneArea) return;

        const sceneId = resolveSceneIdFromElement(target);
        if (!sceneId) return;

        // Inyectar las opciones en cuanto Foundry v14 inserte el #context-menu en el DOM
        [10, 35, 80, 160].forEach(delay => {
            setTimeout(() => injectCinematicOptionsIntoOpenContextMenu(sceneId), delay);
        });
    }, true);
}

/**
 * Añade el botón rápido <kbd>⛶</kbd> a cada escena del Directorio de Escenas (#scenes).
 */
function enhanceSceneDirectoryDOM(rootElement = document) {
    if (!game.user?.isGM || !rootElement) return;

    const scenesContainer = rootElement.id === "scenes"
        ? rootElement
        : (rootElement.querySelector?.("#scenes") || rootElement);

    const items = scenesContainer.querySelectorAll(
        ".directory-item.document, .directory-item.scene, .directory-item[data-entry-id], li[data-document-id], li[data-entry-id]"
    );

    items.forEach(el => {
        if (el.classList.contains("folder")) return;
        const sceneId = resolveSceneIdFromElement(el);
        if (!sceneId) return;

        if (!el.querySelector(".dec-scene-dir-btn")) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "dec-scene-dir-btn";
            btn.dataset.sceneId = sceneId;
            const isThisActive = runtimeState.isCinematic && runtimeState.sceneId === sceneId;
            if (isThisActive) btn.classList.add("dec-active-scene-cinematic");
            btn.title = isThisActive
                ? "Escena en Pantalla Completa (Clic para volver a Modo Normal)"
                : "Activar esta escena en Modo Pantalla Completa (Click: modo por defecto | Shift+Click: Rellenar)";
            btn.innerHTML = `<i class="fa-solid fa-expand"></i>`;

            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (runtimeState.isCinematic && runtimeState.sceneId === sceneId) {
                    deactivateCinematicMode();
                } else {
                    const fitMode = ev.shiftKey ? "cover" : getDefaultFitMode();
                    activateSceneInCinematicMode(sceneId, { fitMode });
                }
            });

            el.appendChild(btn);
        }
    });
}

function refreshDirectoryButtonsState() {
    document.querySelectorAll(".dec-scene-dir-btn").forEach(btn => {
        const sceneId = btn.dataset.sceneId;
        const isActive = Boolean(runtimeState.isCinematic && runtimeState.sceneId === sceneId);
        btn.classList.toggle("dec-active-scene-cinematic", isActive);
        btn.title = isActive
            ? "Escena en Pantalla Completa (Clic para volver a Modo Normal)"
            : "Activar esta escena en Modo Pantalla Completa (Click: modo por defecto | Shift+Click: Rellenar)";
    });
}

/* ==========================================================================
   8. HOOKS DE INICIALIZACIÓN DE FOUNDRY VTT
   ========================================================================== */

window.DorsoEscenaCinematica = {
    activate: (sceneOrId, options) => activateSceneInCinematicMode(sceneOrId, options),
    deactivate: (options) => deactivateCinematicMode(options),
    toggle: (options) => toggleCinematicModeOnCurrentScene(options),
    fitViewport: (fitMode) => fitSceneToViewport(fitMode, true)
};

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Inicializando módulo Escena Cinemática a Pantalla Completa...`);

    game.settings.register(MODULE_ID, "fadeDuration", {
        name: "Duración del Fundido (Fade) en segundos",
        hint: "Tiempo en segundos que tarda el fundido a negro al entrar en Modo Pantalla Completa (por ejemplo: 2 segundos).",
        scope: "world",
        config: true,
        type: Number,
        range: {
            min: 0,
            max: 8,
            step: 0.25
        },
        default: 2.0
    });

    game.settings.register(MODULE_ID, "defaultFitMode", {
        name: "Modo de Ajuste de Pantalla por defecto",
        hint: "Elige cómo se adapta la escena al monitor de cada jugador: 'Completo' muestra toda la ilustración sin recortar nada; 'Rellenar' ocupa todo el monitor sin bandas.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            contain: "Completo (Ver toda la escena sin recortar)",
            cover: "Rellenar (Ocupar todo el monitor sin bordes)"
        },
        default: "contain"
    });

    game.settings.register(MODULE_ID, "cinematicState", {
        name: "Estado activo de Escena Cinemática",
        scope: "world",
        config: false,
        type: Object,
        default: {
            active: false,
            sceneId: null,
            fitMode: "contain",
            fadeMs: 2000,
            timestamp: 0
        },
        onChange: (value) => {
            handleIncomingCinematicPayload(value);
        }
    });

    setupNarrativeZoomAndInteractionLocks();
    setupGlobalSceneContextMenuInterceptor();
});

// Hooks de menú contextual para SceneDirectory y SceneNavigation (compatibilidad v12, v13 y v14)
Hooks.on("getSceneDirectoryEntryContext", injectSceneContextOptions);
Hooks.on("getSceneEntryContextOptions", injectSceneContextOptions);
Hooks.on("getSceneContextOptions", injectSceneContextOptions);
Hooks.on("getSceneNavigationContext", injectSceneContextOptions);
Hooks.on("getSceneNavigationContextOptions", injectSceneContextOptions);

// Botón en la barra de controles de escena de la izquierda para el GM
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;

    const tokenControls = controls.tokens || (Array.isArray(controls) ? controls.find(c => c.name === "token" || c.name === "tokens") : null);
    if (!tokenControls || !tokenControls.tools) return;

    const toolBtn = {
        name: "dorso-escena-cinematica-btn",
        title: "Activar Escena Actual en Pantalla Completa (Cinemática)",
        icon: "fas fa-expand",
        button: true,
        onClick: () => toggleCinematicModeOnCurrentScene()
    };

    if (Array.isArray(tokenControls.tools)) {
        if (!tokenControls.tools.find(t => t.name === "dorso-escena-cinematica-btn")) {
            tokenControls.tools.push(toolBtn);
        }
    } else {
        if (!tokenControls.tools["dorso-escena-cinematica-btn"]) {
            tokenControls.tools["dorso-escena-cinematica-btn"] = toolBtn;
        }
    }
});

// Inyectar botones rápidos en el Directorio de Escenas
Hooks.on("renderSceneDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (root) enhanceSceneDirectoryDOM(root);
});

Hooks.on("canvasReady", async (currentCanvas) => {
    const savedState = getCinematicStateSetting();
    if (!savedState?.active) return;

    const currentSceneId = currentCanvas?.scene?.id;
    if (savedState.sceneId && currentSceneId && savedState.sceneId !== currentSceneId) {
        if (game.user?.isGM && currentCanvas.scene?.active && !runtimeState.isTransitioning) {
            await deactivateCinematicMode({ fadeMs: 600 });
        }
        return;
    }

    if (runtimeState.isCinematic) {
        await fitSceneToViewport(runtimeState.fitMode, false);
        renderGMFloatingHud();
    }
});

Hooks.once("ready", async () => {
    ensureFadeOverlay();
    enhanceSceneDirectoryDOM(document);

    if (game.socket) {
        game.socket.on(SOCKET_NAME, (payload) => {
            handleIncomingCinematicPayload(payload);
        });
    }

    const savedState = getCinematicStateSetting();
    if (savedState?.active && (!savedState.sceneId || savedState.sceneId === canvas?.scene?.id)) {
        await applyLocalCinematicMode({
            ...savedState,
            fadeMs: savedState.fadeMs ?? getFadeMs()
        });
    }
});
