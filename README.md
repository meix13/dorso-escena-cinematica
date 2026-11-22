# Escena Cinemática a Pantalla Completa (`dorso-escena-cinematica`)

Módulo para **Foundry VTT v14** (compatible con v12–v14) diseñado para escenas narrativas de **El Dorso Oscuro**.

## Características principales

1. **Activación en Modo Pantalla Completa con Fundido (Fade) configurable:**
   - Al activar una escena en modo pantalla completa, realiza un fundido a negro suave cuya duración se puede configurar en los ajustes del módulo (por defecto **2 segundos**).
   - Oculta toda la interfaz de Foundry a los jugadores para que la escena ocupe el 100% del contenido del navegador.

2. **Ajuste automático al monitor de cada jugador (`Completo` o `Rellenar`):**
   - **Completo (`contain`):** Calcula la escala ideal para el monitor de cada jugador de forma que se vea el 100% de la escena sin recortar nada.
   - **Rellenar (`cover`):** Ajusta la escala para cubrir hasta el último píxel de la ventana del navegador sin bandas laterales ni superiores.
   - Se puede configurar el modo por defecto en los Ajustes del Módulo y también cambiarlo en vivo desde la barra flotante del GM.

3. **Interacción narrativa (Solo Zoom):**
   - Mientras la escena está en modo pantalla completa, los jugadores no pueden arrastrar tokens, abrir puertas ni desencuadrar el lienzo arrastrándolo.
   - Tienen permitido usar la **rueda del ratón para hacer zoom** hacia los detalles de la escena (manteniendo siempre los límites de la ilustración) y, al alejar el zoom de vuelta, la imagen vuelve a centrarse automáticamente.

4. **Previsualización del GM con Barra Derecha Plegada y Panel Flotante:**
   - El GM previsualiza la escena limpia como los jugadores, pero conserva la **barra lateral derecha plegada** por si necesita desplegar el chat, música o diario en mitad de la escena.
   - En la parte superior central, el GM dispone de una barra flotante discreta desde la que puede alternar entre **Completo / Rellenar**, **Centrar** la vista de todos o pulsar **«Volver a Modo Normal»**.

## Cómo usarlo

- **Desde el Directorio de Escenas:** Haz clic en el botón <kbd>⛶</kbd> junto al nombre de cualquier escena (o <kbd>Shift</kbd> + Clic para forzar el modo *Rellenar*), o haz **clic derecho** sobre la escena en el directorio o en la barra de navegación superior y elige:
  - *Activar en Pantalla Completa*
  - *Pantalla Completa (Modo Completo)*
  - *Pantalla Completa (Modo Rellenar)*
- **Desde los Controles de Escena (barra izquierda):** Pulsa el botón **Activar Escena Actual en Pantalla Completa**.
- **Mediante Macro:**
  ```js
  // Activar la escena actual en pantalla completa
  DorsoEscenaCinematica.activate(canvas.scene, { fitMode: "contain" });

  // Volver a modo normal
  DorsoEscenaCinematica.deactivate();
  ```

## Instalación en Foundry VTT

URL del Manifiesto:
```text
https://raw.githubusercontent.com/meix13/dorso-escena-cinematica/main/module.json
```
