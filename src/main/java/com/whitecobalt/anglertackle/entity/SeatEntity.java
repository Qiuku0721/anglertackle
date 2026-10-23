package com.whitecobalt.anglertackle.entity;

import net.minecraft.core.BlockPos;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.phys.Vec3;

/**
 * 板凳的**座位实体** —— 玩家坐上去时，真正被骑乘的是它，不是方块。
 *
 * <p><b>为什么用实体而不是方块实体</b>：坐姿是原版 {@code Entity.startRiding} 的能力，
 * 只有实体能被骑。用方块实体的话，得自己每 tick 把玩家位置摁到座位上、自己处理
 * 服务端与客户端的同步、自己处理区块卸载 —— 而原版这套已经写好且经过验证了。
 *
 * <p><b>生命周期</b>：坐下时创建、{@link #tick()} 里发现脚下的方块不再是板凳就
 * 让乘客下车并自毁。所以拆除板凳、或在底下挖掉一格，玩家都会自动站起来 ✓
 * （用户 2026-10-09 的需求："做一个椅子功能可以让玩家坐着"）。
 */
public class SeatEntity extends Entity {

    /** 坐在这个座位上能拿到的回拉加成（由脚下方块决定：木板凳 0.01、带坐垫 0.02 ✓）。 */
    private double reelBonus = 0.0;

    public double reelBonus() {
        return this.reelBonus;
    }


    public SeatEntity(EntityType<? extends SeatEntity> type, Level level) {
        super(type, level);
        this.noPhysics = true;          // 座位不参与碰撞，玩家脚不会卡住
    }

    /** 在某个方块上放一个座位、并让玩家坐上去。返回是否成功。 */
    public static boolean sit(Level level, BlockPos pos, Player player) {
        if (level.isClientSide()) return false;
        if (player.isPassenger()) return false;                 // 已经坐着了，别叠罗汉
        // ⚠ 类型必须**惰性取**：在 ModEntities.register() 紧后面取会撞上"unbound value"、直接崩游戏 ✗
        net.minecraft.world.entity.EntityType<SeatEntity> type = com.whitecobalt.anglertackle.registry.ModEntities.STOOL_SEAT.get();
        SeatEntity seat = new SeatEntity(type, level);
        if (level.getBlockState(pos).getBlock() instanceof com.whitecobalt.anglertackle.block.StoolBlock stool) {
            seat.reelBonus = stool.reelBonus();   // 木板凳 1%、带坐垫 2% ✓
        }
        seat.setPos(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5);   // 凳面在方块**半格高**处（照森罗厨娘凳的比例 ✓）
        level.addFreshEntity(seat);
        return player.startRiding(seat);
    }

    @Override
    protected void defineSynchedData(SynchedEntityData.Builder builder) {
        // 座位没有需要同步的状态
    }

    @Override
    protected void readAdditionalSaveData(ValueInput input) {
        // 不落盘：区块卸载后座位消失，玩家自然下车 ✓
    }

    @Override
    protected void addAdditionalSaveData(ValueOutput output) {
        // 同上
    }

    @Override
    public boolean hurtServer(ServerLevel level, DamageSource source, float damage) {
        return false;   // 座位不是生物：任何伤害都不生效（26.1.2 起 Entity 把它声明成 abstract）
    }

    @Override
    public void tick() {
        super.tick();
        if (this.level().isClientSide()) return;
        if (this.getPassengers().isEmpty()) { this.discard(); return; }

        // ⚠ 座位必须**每 tick 同步乘客的朝向** ✓
        //   骑乘时玩家身体的朝向跟着**载具**走 ⇒ 座位朝向固定的话，
        //   坐着的腿就只会朝一个方向摆（用户 2026-10-09 实机："坐上去腿只能向两个方向摆" ✗）
        net.minecraft.world.entity.Entity rider = this.getPassengers().get(0);
        this.setYRot(rider.getYRot());
        this.yRotO = rider.yRotO;
        this.setXRot(0.0F);      // 没人坐了，自毁
        // ⚠ 座位放在 y+0.6 ⇒ blockPosition() 就是板凳**自己那一格**；
        //   第一版查的是 .below()（板凳下面那格＝空气）⇒ 每个 tick 都把玩家踢下去，
        //   表现就是"一坐就立马站起来" ✗（用户 2026-10-09 实机反馈）。
        //   现在查座位所在格 + 往下容错一格 ✓
        net.minecraft.world.level.block.Block at = this.level().getBlockState(this.blockPosition()).getBlock();
        net.minecraft.world.level.block.Block under = this.level().getBlockState(this.blockPosition().below()).getBlock();
        boolean onStool = at instanceof com.whitecobalt.anglertackle.block.StoolBlock
                || under instanceof com.whitecobalt.anglertackle.block.StoolBlock;
        if (!onStool) {
            this.ejectPassengers();
            this.discard();
        }
    }

    @Override
    public boolean isPickable() {
        return false;                   // 不要挡住右击方块
    }

    @Override
    public Vec3 getPassengerRidingPosition(Entity passenger) {
        return this.position();
    }
    /**
     * 乘客转头时原版会回调这里（{@code Entity.setYHeadRot} 里：{@code vehicle.onPassengerTurned(this)}）。
     * 原版默认是空实现 ✗，而 {@code rideTick()} 只同步位置、不管朝向 ⇒ 坐着时玩家的**身体朝向（腿摆向）**
     * 没人更新 ⇒ 只能朝载具的固定方向 ✗（用户 2026-10-09："腿不能自由全向摆动"）。
     * 把**头部朝向灌进身体朝向**，腿就能全向摆了 ✓（yBodyRotO 只有 LivingEntity 有 ⇒ 先判类型 ✓）
     */
    @Override
    public void onPassengerTurned(net.minecraft.world.entity.Entity passenger) {
        if (passenger instanceof net.minecraft.world.entity.LivingEntity living) {
            living.setYBodyRot(living.getYHeadRot());
            living.yBodyRotO = living.yBodyRot;
        }
        this.setYRot(passenger.getYRot());
        this.yRotO = this.getYRot();
    }
}