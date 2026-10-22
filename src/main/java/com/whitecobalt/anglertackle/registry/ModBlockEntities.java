package com.whitecobalt.anglertackle.registry;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.block.FishRackBlockEntity;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/** 方块实体注册表。 */
public final class ModBlockEntities {

    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, AnglersTackle.MOD_ID);

    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<FishRackBlockEntity>> FISH_RACK =
            BLOCK_ENTITIES.register("fish_rack", () -> BlockEntityType.Builder
                    .of(FishRackBlockEntity::new, ModBlocks.FISH_RACK.get())
                    .build(null));

    public static void register(IEventBus modBus) {
        BLOCK_ENTITIES.register(modBus);
    }

    private ModBlockEntities() {
    }
}
