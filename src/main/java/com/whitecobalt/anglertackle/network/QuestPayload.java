package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：**委托面板快照**（老柯的每日 / 周常；策划 `docs/40` §9，用户 2026-10-14 定案）。
 *
 * <p>与 {@link TitlePayload} / {@link MailPayload} 同一套做法：**扁平字符串行**、不定义嵌套 record。
 * 每行一条已接委托，竖线分隔、顺序固定：
 *
 * <pre>
 *   id|progress|claimed
 * </pre>
 *
 * <ul>
 *   <li>{@code progress} —— `QuestData.Row.progress` 的**原始值**（单位随目标变：条数 / 重量×100 / 命中种数…）。
 *       ⚠ 这里**故意不换算**：换算是 {@code QuestGoal.display()} 的事，而那几个类都在客户端能加载的
 *       common 侧（纯表、不碰服务端类型）⇒ **单位口径只有一份**，界面不会和判定各算各的 ✗。</li>
 *   <li>{@code claimed} = 这一条的**奖励寄出去了没有**（与 `QuestData.Row.claimed` 逐字对应）；
 *       "奖励信已经在你邮箱里了"和"你还没点领取"是两件事，界面按它显示"已完成"。</li>
 *   <li><b>名字 / 目标 / 奖励的文案全在客户端</b>：名字 = 语言键 {@code quest.anglertackle.<id>.name}、
 *       目标与奖励由客户端读 {@code QuestPool} 的定义现算 ⇒ **服务端一个中文字都不发** ✓
 *       —— 这条纪律的落点就在这个包里（`MailEntry` 的类注释写着它的由来）。</li>
 * </ul>
 *
 * @param rows           已接委托，每行 {@code id|progress|claimed}
 * @param activity       本周活跃度
 * @param cap            周上限（`Tuning.questActivityCapWeekly()`）
 * @param claimedTiers   已领档位**位掩码**（bit0=25 / bit1=50 / bit2=75 / bit3=100）
 * @param tierAt         四个档位的**数值**（25/50/75/100）—— 服务端算好放进来，
 *                       客户端就**不必知道**档位表长什么样（`QuestService.TIER_AT` 在服务端流程类里，
 *                       客户端加载它会牵进 `ServerPlayer` / `MailService` ✗ —— 那正是 `ModNetwork` 那次事故的形状）
 * @param dailyLeftMin   本游戏日还剩几分钟（界面显示"今日还剩 8 分钟"）
 * @param weeklyLeftDays 本周还剩几个游戏日
 * @param lastError      上一次动作的结果码（空串 = 成功；由界面翻成一句话 —— 与 `MailPayload` 同一条做法）
 */
public record QuestPayload(
        List<String> rows,
        int activity,
        int cap,
        int claimedTiers,
        List<Integer> tierAt,
        int dailyLeftMin,
        int weeklyLeftDays,
        String lastError) implements CustomPacketPayload {

    /** 行的字段分隔符（与 `TitleNameplatePayload` 同一套）。 */
    public static final String FIELD_SEP = "|";

    public static final CustomPacketPayload.Type<QuestPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "quests"));

    public static final StreamCodec<FriendlyByteBuf, QuestPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeVarInt(p.activity);
                buf.writeVarInt(p.cap);
                buf.writeVarInt(p.claimedTiers);
                buf.writeVarInt(p.tierAt.size());
                for (int t : p.tierAt) {
                    buf.writeVarInt(t);
                }
                buf.writeVarInt(p.dailyLeftMin);
                buf.writeVarInt(p.weeklyLeftDays);
                buf.writeUtf(p.lastError == null ? "" : p.lastError);
                buf.writeVarInt(p.rows.size());
                for (String r : p.rows) {
                    buf.writeUtf(r);
                }
            },
            buf -> {
                int activity = buf.readVarInt();
                int cap = buf.readVarInt();
                int claimed = buf.readVarInt();
                int tn = buf.readVarInt();
                List<Integer> tiers = new ArrayList<>(tn);
                for (int i = 0; i < tn; i++) {
                    tiers.add(buf.readVarInt());
                }
                int leftMin = buf.readVarInt();
                int leftDays = buf.readVarInt();
                String err = buf.readUtf();
                int n = buf.readVarInt();
                List<String> rows = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    rows.add(buf.readUtf());
                }
                return new QuestPayload(rows, activity, cap, claimed, tiers, leftMin, leftDays, err);
            });

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
