import type { ModuleVisualRegion } from "./moduleInteractions"

type ModuleInteractionLayerProps = {
  regions: ModuleVisualRegion[]
  activeModuleId: string | null
  hoveredModuleId: string | null
}

export function ModuleInteractionLayer({
  regions,
  activeModuleId,
  hoveredModuleId,
}: ModuleInteractionLayerProps) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none td-module-interaction-layer td-module-interaction-only"
    >
      {regions.map((region) => {
        const state = region.moduleId === activeModuleId
          ? "active"
          : region.moduleId === hoveredModuleId
            ? "hovered"
            : undefined

        return state
          ? (
              <div
                key={`${region.moduleId}:${region.pageIndex}`}
                className="absolute td-module-interaction-region"
                data-state={state}
                data-testid={`module-region-${region.moduleId}`}
                style={{
                  top: region.top,
                  left: region.left,
                  width: region.width,
                  height: region.height,
                }}
              />
            )
          : null
      })}
    </div>
  )
}
