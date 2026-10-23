package com.whitecobalt.anglertackle.block;

import com.whitecobalt.anglertackle.registry.ModBlockEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 鱼架里存的那一条鱼。
 *
 * <p>存的是**整个 ItemStack**而不是"鱼种 id + 长度"：FishData 组件本来就带
 * 鱼种/体长/重量/品质，原样留着，取下来还给玩家的就是**同一条鱼**，
 * 不会变成"一条新的同类鱼"。这也省掉了一套自定义 NBT 读写。
 */
public class FishRackBlockEntity extends BlockEntity {

    private ItemStack fish = ItemStack.EMPTY;

    public FishRackBlockEntity(BlockPos pos, BlockState state) {
        super(ModBlockEntities.FISH_RACK.get(), pos, state);
    }

    public ItemStack fish() {
        return this.fish;
    }

    public void setFish(ItemStack stack) {
        this.fish = stack;
        this.setChanged();
        if (this.level != null) {
            // 渲染器读的是客户端这份，不发给客户端的话鱼架会是空的
            this.level.sendBlockUpdated(this.worldPosition, this.getBlockState(),
                    this.getBlockState(), 3);
        }
    }

    @Override
    protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.saveAdditional(tag, registries);
        if (!this.fish.isEmpty()) {
            tag.put("Fish", this.fish.save(registries));
        }
    }

    @Override
    protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.loadAdditional(tag, registries);
        this.fish = tag.contains("Fish")
                ? ItemStack.parseOptional(registries, tag.getCompoundOrEmpty("Fish"))
                : ItemStack.EMPTY;
    }

    /** 方块实体同步包：没有它客户端拿不到这条鱼，鱼架上就是空的。 */
    @Override
    public CompoundTag getUpdateTag(HolderLookup.Provider registries) {
        return this.saveCustomOnly(registries);
    }

    @Override
    public ClientboundBlockEntityDataPacket getUpdatePacket() {
        return ClientboundBlockEntityDataPacket.create(this);
    }
}
