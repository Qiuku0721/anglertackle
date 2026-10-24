package com.whitecobalt.anglertackle.block;

import com.whitecobalt.anglertackle.registry.ModBlockEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.Containers;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * 鱼架里存的那一条鱼。
 *
 * <p>存的是**整个 ItemStack**而不是"鱼种 id + 长度"：FishData 组件本来就带
 * 鱼种/体长/重量/品质，原样留着，取下来还给玩家的就是**同一条鱼**，
 * 不会变成"一条新的同类鱼"。这也省掉了一套自定义 NBT 读写。
 */
public class FishRackBlockEntity extends BlockEntity {

    private ItemStack fish = ItemStack.EMPTY;

    /** 区块卸载标记（{@code onChunkUnloaded} 比 {@code setRemoved} 先调）。 */
    private boolean chunkUnloaded;

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
    protected void saveAdditional(ValueOutput output) {
        super.saveAdditional(output);
        // 与旧版同口径：**有鱼才写** "Fish"（空手 = 不写这个键）。
        // 旧版是 this.fish.save(registries)，26.1.2 的对应物就是 ItemStack.CODEC（键仍是 id/count/components）。
        output.storeNullable("Fish", ItemStack.CODEC, this.fish.isEmpty() ? null : this.fish);
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        // 旧版没有 "Fish" 键 ⇒ ItemStack.EMPTY；ItemStack.CODEC 缺键同样返回 empty。
        this.fish = input.read("Fish", ItemStack.CODEC).orElse(ItemStack.EMPTY);
    }

    /**
     * **主钩子**：拆掉 / 炸掉 / 被替换时，把架上那条鱼原样吐出来。
     *
     * <p>{@code LevelChunk.setBlockState} 在**移除方块实体之前**调它
     * （{@code LevelChunk.java:311}），条件是服务端 + 方块类型真的变了 +
     * 没带 {@code UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS(256)}。
     * 覆盖三条路径：
     * <ul>
     *   <li>生存挖掘 → {@code ServerPlayerGameMode.destroyBlock} → {@code removeBlock}
     *       → {@code LevelChunk.setBlockState}（flags=3）；</li>
     *   <li>爆炸 → {@code ServerExplosion} → {@code onExplosionHit} → {@code onBlockExploded}
     *       → {@code setBlock(..., AIR, 3)}（flags=3）；</li>
     *   <li>创造拆除 → {@code player.preventsBlockDrops()} 分支 → {@code removeBlock}
     *       （flags=3）。</li>
     * </ul>
     *
     * <p>⚠ 第四条 {@code /setblock}（以及 {@code /fill}）**不经过这里**：它们传的 flags 是
     * {@code 2 | (strict ? 816 : 256)}（{@code SetBlockCommand.java:117}、
     * {@code FillCommand.java:188}），256 正是 {@code UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS}
     * ⇒ {@code LevelChunk.java:306} 把 {@code sideEffects} 判成 false。
     * 那条路只在后面 {@code removeBlockEntity(pos)} 时留下 {@link #setRemoved()} 一个回调，
     * 所以由下面那个兜底负责。
     *
     * <p>⚠ 别在 {@code FishRackBlock#getDrops} / {@code playerWillDestroy} 里再发一次：
     * 生存与爆炸会走 {@code getDrops}、创造会走 {@code playerWillDestroy}，而它们最终
     * 都经过这里 ⇒ 会吐两份。方块本体（架子）的掉落只由 {@code fish_rack} 掉落表负责，
     * 这里补的只有架上那条鱼。
     */
    @Override
    public void preRemoveSideEffects(BlockPos pos, BlockState state) {
        super.preRemoveSideEffects(pos, state);
        this.dropFish(pos);
    }

    /**
     * **兜底**：命令替换（{@code /setblock} / {@code /fill}）不触发 {@link #preRemoveSideEffects}，
     * 但换掉方块后一定会 {@code removeBlockEntity(pos)} → {@link #setRemoved()}。
     *
     * <p>⚠ 区块卸载也走 {@code clearAllBlockEntities() → onChunkUnloaded() → setRemoved()}
     * （{@code LevelChunk.java:687-690}）。那时**绝不能吐鱼**：方块实体的 NBT 已经存好，
     * 重新加载时鱼还在架上，吐一条就等于"走远一趟多一条"。所以用
     * {@link #onChunkUnloaded()} 置位、这里跳过。
     *
     * <p>两个钩子共用 {@link #dropFish(BlockPos)} 的「吐一次就清空」：谁先到谁吐，
     * 后到的看到 {@code fish} 已空 ⇒ 天然去重。
     */
    @Override
    public void setRemoved() {
        super.setRemoved();
        if (!this.chunkUnloaded) {
            this.dropFish(this.worldPosition);
        }
    }

    @Override
    public void onChunkUnloaded() {
        this.chunkUnloaded = true;
        super.onChunkUnloaded();
    }

    /** 吐一次鱼：吐完立刻清空 —— 重复回调（preRemove + setRemoved）不会吐第二份。 */
    private void dropFish(BlockPos pos) {
        if (this.fish.isEmpty() || this.level == null || this.level.isClientSide()) {
            return;
        }
        ItemStack out = this.fish;
        this.fish = ItemStack.EMPTY;
        Containers.dropItemStack(this.level, pos.getX(), pos.getY(), pos.getZ(), out);
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
