package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.Config;

import java.util.HashMap;
import java.util.Map;

/**
 * 鱼种数值的**运行期读取层**——让"每条鱼的数值"能在游戏里改、不用重启。
 *
 * <h2>为什么不能直接把配置读进 {@code FishSpecies.ALL}</h2>
 * {@code FishSpecies.ALL} 是 {@code static final List.of(...)}，每条鱼都带着自己的数值。
 * 想在运行期改数值就得改这些对象，而 record 与 {@code List.of} 都不可变 ——
 * 于是"改配置"只能变成"重建整个列表"，但那个列表被图鉴、指令、鱼池构建到处引用着，
 * 重建会让引用失效。
 *
 * <p>所以换个做法：{@code FishSpecies.ALL} 保持不动（只存 id、物品、档位表、竿型、
 * 原型，以及作为设计意图记录的 spec* 数值），<b>运行期要用的数值一律从本类按 id 现取</b>。
 * 配置文件里改了值，下一次抛投就用新值，不需要重建任何对象。
 *
 * <h2>手感档案为什么是"每次现建"</h2>
 * {@link FightProfile} 是 record，13 个字段全是数值。每次
 * {@link #profile(String, FightProfile.Archetype)} 都新建一个 —— 看着浪费，
 * 但一场对抗只会调用一次（咬钩进 FIGHT 状态时快照），而且这样天然得到
 * "改配置只影响下一场，不影响正在遛的这条鱼"。反过来缓存住，热重载就会对
 * 已上钩的鱼也生效，遛到一半手感突然变了，玩家只会觉得"卡了"。
 *
 * <h2>兜底</h2>
 * 任何一步出错（配置还没加载、id 不认识）都退回鲫鱼的档案 —— 最温和的一条。
 * 宁可给一条好钓的鱼，也不能因为读配置失败就崩，更不能返回 0
 *（0 会让鱼原地不动，看起来像"功能坏了"）。
 *
 * <p>本文件里 {@code // ==== BEGIN 生成区} 到 {@code // ==== END 生成区} 之间的内容
 * 由 {@code tools/gen-fish-config.js} 生成，勿手改。
 */
public final class FishTuning {

    private FishTuning() {
    }

    /** 读不到配置时的兜底档案（鲫鱼：最温和）。 */
    private static final FightProfile FALLBACK = FightProfile.CRUCIAN_CARP;

    /**
     * 运行期解析出来的每条鱼的 13 个数值，键就是鱼种 id。
     *
     * <p>用 Map 而不是 21 组字段：鱼种是数据（会增删），
     * Map 让构建函数变成一段循环，加鱼不用改本类的结构。
     */
    private static final Map<String, Values> VALUES = new HashMap<>();

    /** 一个鱼种的 13 个数值（与 tools/fish-source.js 的 FIELDS 一一对应）。 */
    public record Values(
            double minKg,
            double maxKg,
            double pullSpeed,
            double fatiguedPullSpeed,
            double stamina,
            double tensionGain,
            double sprintDurationSec,
            double sprintIntervalSec,
            double turnIntervalSec,
            double fakeOutChance,
            double fatigueThreshold,
            double fatigueDurationSec,
            double staminaRegen
    ) {
        /** 组装成手感档案。 */
        public FightProfile toProfile(FightProfile.Archetype archetype) {
            return new FightProfile(archetype,
                    pullSpeed, fatiguedPullSpeed,
                    sprintDurationSec, sprintIntervalSec, turnIntervalSec,
                    fakeOutChance, tensionGain, stamina,
                    fatigueThreshold, fatigueDurationSec, staminaRegen);
        }
    }

    // ================================================================ 构建

    /**
     * 从配置读一遍全部鱼种数值。{@link Tuning#reload()} 会调用它。
     *
     * <p>逐项显式读取而不是反射：反射在混淆下脆弱，而且显式写更容易在编译期
     * 发现"某个配置项漏接了"。
     */
    public static void build() {
        try {
            Config c = Tuning.cfgPublic();
            if (c == null) {
                AnglersTackle.LOGGER.debug("[垂纶] 鱼种数值暂缓装载：配置还没就绪");
                return;
            }
            Map<String, Values> next = new HashMap<>();
            // ==== BEGIN 生成区（gen-fish-config.js，勿手改）====
            next.put("crucian_carp", new Values(
                    c.crucianCarpMinKg.get(),
                    c.crucianCarpMaxKg.get(),
                    c.crucianCarpPullSpeed.get(),
                    c.crucianCarpFatiguedPullSpeed.get(),
                    c.crucianCarpStamina.get(),
                    c.crucianCarpTensionGain.get(),
                    c.crucianCarpSprintDurationSec.get(),
                    c.crucianCarpSprintIntervalSec.get(),
                    c.crucianCarpTurnIntervalSec.get(),
                    c.crucianCarpFakeOutChance.get(),
                    c.crucianCarpFatigueThreshold.get(),
                    c.crucianCarpFatigueDurationSec.get(),
                    c.crucianCarpStaminaRegen.get()));

            next.put("tilapia", new Values(
                    c.tilapiaMinKg.get(),
                    c.tilapiaMaxKg.get(),
                    c.tilapiaPullSpeed.get(),
                    c.tilapiaFatiguedPullSpeed.get(),
                    c.tilapiaStamina.get(),
                    c.tilapiaTensionGain.get(),
                    c.tilapiaSprintDurationSec.get(),
                    c.tilapiaSprintIntervalSec.get(),
                    c.tilapiaTurnIntervalSec.get(),
                    c.tilapiaFakeOutChance.get(),
                    c.tilapiaFatigueThreshold.get(),
                    c.tilapiaFatigueDurationSec.get(),
                    c.tilapiaStaminaRegen.get()));

            next.put("mullet", new Values(
                    c.mulletMinKg.get(),
                    c.mulletMaxKg.get(),
                    c.mulletPullSpeed.get(),
                    c.mulletFatiguedPullSpeed.get(),
                    c.mulletStamina.get(),
                    c.mulletTensionGain.get(),
                    c.mulletSprintDurationSec.get(),
                    c.mulletSprintIntervalSec.get(),
                    c.mulletTurnIntervalSec.get(),
                    c.mulletFakeOutChance.get(),
                    c.mulletFatigueThreshold.get(),
                    c.mulletFatigueDurationSec.get(),
                    c.mulletStaminaRegen.get()));

            next.put("grass_carp", new Values(
                    c.grassCarpMinKg.get(),
                    c.grassCarpMaxKg.get(),
                    c.grassCarpPullSpeed.get(),
                    c.grassCarpFatiguedPullSpeed.get(),
                    c.grassCarpStamina.get(),
                    c.grassCarpTensionGain.get(),
                    c.grassCarpSprintDurationSec.get(),
                    c.grassCarpSprintIntervalSec.get(),
                    c.grassCarpTurnIntervalSec.get(),
                    c.grassCarpFakeOutChance.get(),
                    c.grassCarpFatigueThreshold.get(),
                    c.grassCarpFatigueDurationSec.get(),
                    c.grassCarpStaminaRegen.get()));

            next.put("black_carp", new Values(
                    c.blackCarpMinKg.get(),
                    c.blackCarpMaxKg.get(),
                    c.blackCarpPullSpeed.get(),
                    c.blackCarpFatiguedPullSpeed.get(),
                    c.blackCarpStamina.get(),
                    c.blackCarpTensionGain.get(),
                    c.blackCarpSprintDurationSec.get(),
                    c.blackCarpSprintIntervalSec.get(),
                    c.blackCarpTurnIntervalSec.get(),
                    c.blackCarpFakeOutChance.get(),
                    c.blackCarpFatigueThreshold.get(),
                    c.blackCarpFatigueDurationSec.get(),
                    c.blackCarpStaminaRegen.get()));

            next.put("banded_loach", new Values(
                    c.bandedLoachMinKg.get(),
                    c.bandedLoachMaxKg.get(),
                    c.bandedLoachPullSpeed.get(),
                    c.bandedLoachFatiguedPullSpeed.get(),
                    c.bandedLoachStamina.get(),
                    c.bandedLoachTensionGain.get(),
                    c.bandedLoachSprintDurationSec.get(),
                    c.bandedLoachSprintIntervalSec.get(),
                    c.bandedLoachTurnIntervalSec.get(),
                    c.bandedLoachFakeOutChance.get(),
                    c.bandedLoachFatigueThreshold.get(),
                    c.bandedLoachFatigueDurationSec.get(),
                    c.bandedLoachStaminaRegen.get()));

            next.put("hemiculter", new Values(
                    c.hemiculterMinKg.get(),
                    c.hemiculterMaxKg.get(),
                    c.hemiculterPullSpeed.get(),
                    c.hemiculterFatiguedPullSpeed.get(),
                    c.hemiculterStamina.get(),
                    c.hemiculterTensionGain.get(),
                    c.hemiculterSprintDurationSec.get(),
                    c.hemiculterSprintIntervalSec.get(),
                    c.hemiculterTurnIntervalSec.get(),
                    c.hemiculterFakeOutChance.get(),
                    c.hemiculterFatigueThreshold.get(),
                    c.hemiculterFatigueDurationSec.get(),
                    c.hemiculterStaminaRegen.get()));

            next.put("topmouth_culter", new Values(
                    c.topmouthCulterMinKg.get(),
                    c.topmouthCulterMaxKg.get(),
                    c.topmouthCulterPullSpeed.get(),
                    c.topmouthCulterFatiguedPullSpeed.get(),
                    c.topmouthCulterStamina.get(),
                    c.topmouthCulterTensionGain.get(),
                    c.topmouthCulterSprintDurationSec.get(),
                    c.topmouthCulterSprintIntervalSec.get(),
                    c.topmouthCulterTurnIntervalSec.get(),
                    c.topmouthCulterFakeOutChance.get(),
                    c.topmouthCulterFatigueThreshold.get(),
                    c.topmouthCulterFatigueDurationSec.get(),
                    c.topmouthCulterStaminaRegen.get()));

            next.put("zander", new Values(
                    c.zanderMinKg.get(),
                    c.zanderMaxKg.get(),
                    c.zanderPullSpeed.get(),
                    c.zanderFatiguedPullSpeed.get(),
                    c.zanderStamina.get(),
                    c.zanderTensionGain.get(),
                    c.zanderSprintDurationSec.get(),
                    c.zanderSprintIntervalSec.get(),
                    c.zanderTurnIntervalSec.get(),
                    c.zanderFakeOutChance.get(),
                    c.zanderFatigueThreshold.get(),
                    c.zanderFatigueDurationSec.get(),
                    c.zanderStaminaRegen.get()));

            next.put("sapphire_snakehead", new Values(
                    c.sapphireSnakeheadMinKg.get(),
                    c.sapphireSnakeheadMaxKg.get(),
                    c.sapphireSnakeheadPullSpeed.get(),
                    c.sapphireSnakeheadFatiguedPullSpeed.get(),
                    c.sapphireSnakeheadStamina.get(),
                    c.sapphireSnakeheadTensionGain.get(),
                    c.sapphireSnakeheadSprintDurationSec.get(),
                    c.sapphireSnakeheadSprintIntervalSec.get(),
                    c.sapphireSnakeheadTurnIntervalSec.get(),
                    c.sapphireSnakeheadFakeOutChance.get(),
                    c.sapphireSnakeheadFatigueThreshold.get(),
                    c.sapphireSnakeheadFatigueDurationSec.get(),
                    c.sapphireSnakeheadStaminaRegen.get()));

            next.put("platinum_arowana", new Values(
                    c.platinumArowanaMinKg.get(),
                    c.platinumArowanaMaxKg.get(),
                    c.platinumArowanaPullSpeed.get(),
                    c.platinumArowanaFatiguedPullSpeed.get(),
                    c.platinumArowanaStamina.get(),
                    c.platinumArowanaTensionGain.get(),
                    c.platinumArowanaSprintDurationSec.get(),
                    c.platinumArowanaSprintIntervalSec.get(),
                    c.platinumArowanaTurnIntervalSec.get(),
                    c.platinumArowanaFakeOutChance.get(),
                    c.platinumArowanaFatigueThreshold.get(),
                    c.platinumArowanaFatigueDurationSec.get(),
                    c.platinumArowanaStaminaRegen.get()));

            next.put("oxeye_tarpon", new Values(
                    c.oxeyeTarponMinKg.get(),
                    c.oxeyeTarponMaxKg.get(),
                    c.oxeyeTarponPullSpeed.get(),
                    c.oxeyeTarponFatiguedPullSpeed.get(),
                    c.oxeyeTarponStamina.get(),
                    c.oxeyeTarponTensionGain.get(),
                    c.oxeyeTarponSprintDurationSec.get(),
                    c.oxeyeTarponSprintIntervalSec.get(),
                    c.oxeyeTarponTurnIntervalSec.get(),
                    c.oxeyeTarponFakeOutChance.get(),
                    c.oxeyeTarponFatigueThreshold.get(),
                    c.oxeyeTarponFatigueDurationSec.get(),
                    c.oxeyeTarponStaminaRegen.get()));

            next.put("atlantic_salmon", new Values(
                    c.atlanticSalmonMinKg.get(),
                    c.atlanticSalmonMaxKg.get(),
                    c.atlanticSalmonPullSpeed.get(),
                    c.atlanticSalmonFatiguedPullSpeed.get(),
                    c.atlanticSalmonStamina.get(),
                    c.atlanticSalmonTensionGain.get(),
                    c.atlanticSalmonSprintDurationSec.get(),
                    c.atlanticSalmonSprintIntervalSec.get(),
                    c.atlanticSalmonTurnIntervalSec.get(),
                    c.atlanticSalmonFakeOutChance.get(),
                    c.atlanticSalmonFatigueThreshold.get(),
                    c.atlanticSalmonFatigueDurationSec.get(),
                    c.atlanticSalmonStaminaRegen.get()));

            next.put("bluefin_tuna", new Values(
                    c.bluefinTunaMinKg.get(),
                    c.bluefinTunaMaxKg.get(),
                    c.bluefinTunaPullSpeed.get(),
                    c.bluefinTunaFatiguedPullSpeed.get(),
                    c.bluefinTunaStamina.get(),
                    c.bluefinTunaTensionGain.get(),
                    c.bluefinTunaSprintDurationSec.get(),
                    c.bluefinTunaSprintIntervalSec.get(),
                    c.bluefinTunaTurnIntervalSec.get(),
                    c.bluefinTunaFakeOutChance.get(),
                    c.bluefinTunaFatigueThreshold.get(),
                    c.bluefinTunaFatigueDurationSec.get(),
                    c.bluefinTunaStaminaRegen.get()));

            next.put("juvenile_shark", new Values(
                    c.juvenileSharkMinKg.get(),
                    c.juvenileSharkMaxKg.get(),
                    c.juvenileSharkPullSpeed.get(),
                    c.juvenileSharkFatiguedPullSpeed.get(),
                    c.juvenileSharkStamina.get(),
                    c.juvenileSharkTensionGain.get(),
                    c.juvenileSharkSprintDurationSec.get(),
                    c.juvenileSharkSprintIntervalSec.get(),
                    c.juvenileSharkTurnIntervalSec.get(),
                    c.juvenileSharkFakeOutChance.get(),
                    c.juvenileSharkFatigueThreshold.get(),
                    c.juvenileSharkFatigueDurationSec.get(),
                    c.juvenileSharkStaminaRegen.get()));

            next.put("tigerfish", new Values(
                    c.tigerfishMinKg.get(),
                    c.tigerfishMaxKg.get(),
                    c.tigerfishPullSpeed.get(),
                    c.tigerfishFatiguedPullSpeed.get(),
                    c.tigerfishStamina.get(),
                    c.tigerfishTensionGain.get(),
                    c.tigerfishSprintDurationSec.get(),
                    c.tigerfishSprintIntervalSec.get(),
                    c.tigerfishTurnIntervalSec.get(),
                    c.tigerfishFakeOutChance.get(),
                    c.tigerfishFatigueThreshold.get(),
                    c.tigerfishFatigueDurationSec.get(),
                    c.tigerfishStaminaRegen.get()));

            next.put("pike", new Values(
                    c.pikeMinKg.get(),
                    c.pikeMaxKg.get(),
                    c.pikePullSpeed.get(),
                    c.pikeFatiguedPullSpeed.get(),
                    c.pikeStamina.get(),
                    c.pikeTensionGain.get(),
                    c.pikeSprintDurationSec.get(),
                    c.pikeSprintIntervalSec.get(),
                    c.pikeTurnIntervalSec.get(),
                    c.pikeFakeOutChance.get(),
                    c.pikeFatigueThreshold.get(),
                    c.pikeFatigueDurationSec.get(),
                    c.pikeStaminaRegen.get()));

            next.put("brown_trout", new Values(
                    c.brownTroutMinKg.get(),
                    c.brownTroutMaxKg.get(),
                    c.brownTroutPullSpeed.get(),
                    c.brownTroutFatiguedPullSpeed.get(),
                    c.brownTroutStamina.get(),
                    c.brownTroutTensionGain.get(),
                    c.brownTroutSprintDurationSec.get(),
                    c.brownTroutSprintIntervalSec.get(),
                    c.brownTroutTurnIntervalSec.get(),
                    c.brownTroutFakeOutChance.get(),
                    c.brownTroutFatigueThreshold.get(),
                    c.brownTroutFatigueDurationSec.get(),
                    c.brownTroutStaminaRegen.get()));

            next.put("mirror_carp", new Values(
                    c.mirrorCarpMinKg.get(),
                    c.mirrorCarpMaxKg.get(),
                    c.mirrorCarpPullSpeed.get(),
                    c.mirrorCarpFatiguedPullSpeed.get(),
                    c.mirrorCarpStamina.get(),
                    c.mirrorCarpTensionGain.get(),
                    c.mirrorCarpSprintDurationSec.get(),
                    c.mirrorCarpSprintIntervalSec.get(),
                    c.mirrorCarpTurnIntervalSec.get(),
                    c.mirrorCarpFakeOutChance.get(),
                    c.mirrorCarpFatigueThreshold.get(),
                    c.mirrorCarpFatigueDurationSec.get(),
                    c.mirrorCarpStaminaRegen.get()));

            next.put("striped_bass", new Values(
                    c.stripedBassMinKg.get(),
                    c.stripedBassMaxKg.get(),
                    c.stripedBassPullSpeed.get(),
                    c.stripedBassFatiguedPullSpeed.get(),
                    c.stripedBassStamina.get(),
                    c.stripedBassTensionGain.get(),
                    c.stripedBassSprintDurationSec.get(),
                    c.stripedBassSprintIntervalSec.get(),
                    c.stripedBassTurnIntervalSec.get(),
                    c.stripedBassFakeOutChance.get(),
                    c.stripedBassFatigueThreshold.get(),
                    c.stripedBassFatigueDurationSec.get(),
                    c.stripedBassStaminaRegen.get()));

            next.put("arapaima", new Values(
                    c.arapaimaMinKg.get(),
                    c.arapaimaMaxKg.get(),
                    c.arapaimaPullSpeed.get(),
                    c.arapaimaFatiguedPullSpeed.get(),
                    c.arapaimaStamina.get(),
                    c.arapaimaTensionGain.get(),
                    c.arapaimaSprintDurationSec.get(),
                    c.arapaimaSprintIntervalSec.get(),
                    c.arapaimaTurnIntervalSec.get(),
                    c.arapaimaFakeOutChance.get(),
                    c.arapaimaFatigueThreshold.get(),
                    c.arapaimaFatigueDurationSec.get(),
                    c.arapaimaStaminaRegen.get()));

            next.put("african_butterflyfish", new Values(
                    c.africanButterflyfishMinKg.get(),
                    c.africanButterflyfishMaxKg.get(),
                    c.africanButterflyfishPullSpeed.get(),
                    c.africanButterflyfishFatiguedPullSpeed.get(),
                    c.africanButterflyfishStamina.get(),
                    c.africanButterflyfishTensionGain.get(),
                    c.africanButterflyfishSprintDurationSec.get(),
                    c.africanButterflyfishSprintIntervalSec.get(),
                    c.africanButterflyfishTurnIntervalSec.get(),
                    c.africanButterflyfishFakeOutChance.get(),
                    c.africanButterflyfishFatigueThreshold.get(),
                    c.africanButterflyfishFatigueDurationSec.get(),
                    c.africanButterflyfishStaminaRegen.get()));

            next.put("jewel_cichlid", new Values(
                    c.jewelCichlidMinKg.get(),
                    c.jewelCichlidMaxKg.get(),
                    c.jewelCichlidPullSpeed.get(),
                    c.jewelCichlidFatiguedPullSpeed.get(),
                    c.jewelCichlidStamina.get(),
                    c.jewelCichlidTensionGain.get(),
                    c.jewelCichlidSprintDurationSec.get(),
                    c.jewelCichlidSprintIntervalSec.get(),
                    c.jewelCichlidTurnIntervalSec.get(),
                    c.jewelCichlidFakeOutChance.get(),
                    c.jewelCichlidFatigueThreshold.get(),
                    c.jewelCichlidFatigueDurationSec.get(),
                    c.jewelCichlidStaminaRegen.get()));

            next.put("guppy", new Values(
                    c.guppyMinKg.get(),
                    c.guppyMaxKg.get(),
                    c.guppyPullSpeed.get(),
                    c.guppyFatiguedPullSpeed.get(),
                    c.guppyStamina.get(),
                    c.guppyTensionGain.get(),
                    c.guppySprintDurationSec.get(),
                    c.guppySprintIntervalSec.get(),
                    c.guppyTurnIntervalSec.get(),
                    c.guppyFakeOutChance.get(),
                    c.guppyFatigueThreshold.get(),
                    c.guppyFatigueDurationSec.get(),
                    c.guppyStaminaRegen.get()));

            next.put("elephantnose", new Values(
                    c.elephantnoseMinKg.get(),
                    c.elephantnoseMaxKg.get(),
                    c.elephantnosePullSpeed.get(),
                    c.elephantnoseFatiguedPullSpeed.get(),
                    c.elephantnoseStamina.get(),
                    c.elephantnoseTensionGain.get(),
                    c.elephantnoseSprintDurationSec.get(),
                    c.elephantnoseSprintIntervalSec.get(),
                    c.elephantnoseTurnIntervalSec.get(),
                    c.elephantnoseFakeOutChance.get(),
                    c.elephantnoseFatigueThreshold.get(),
                    c.elephantnoseFatigueDurationSec.get(),
                    c.elephantnoseStaminaRegen.get()));

            next.put("golden_loach", new Values(
                    c.goldenLoachMinKg.get(),
                    c.goldenLoachMaxKg.get(),
                    c.goldenLoachPullSpeed.get(),
                    c.goldenLoachFatiguedPullSpeed.get(),
                    c.goldenLoachStamina.get(),
                    c.goldenLoachTensionGain.get(),
                    c.goldenLoachSprintDurationSec.get(),
                    c.goldenLoachSprintIntervalSec.get(),
                    c.goldenLoachTurnIntervalSec.get(),
                    c.goldenLoachFakeOutChance.get(),
                    c.goldenLoachFatigueThreshold.get(),
                    c.goldenLoachFatigueDurationSec.get(),
                    c.goldenLoachStaminaRegen.get()));

            next.put("cave_blindfish", new Values(
                    c.caveBlindfishMinKg.get(),
                    c.caveBlindfishMaxKg.get(),
                    c.caveBlindfishPullSpeed.get(),
                    c.caveBlindfishFatiguedPullSpeed.get(),
                    c.caveBlindfishStamina.get(),
                    c.caveBlindfishTensionGain.get(),
                    c.caveBlindfishSprintDurationSec.get(),
                    c.caveBlindfishSprintIntervalSec.get(),
                    c.caveBlindfishTurnIntervalSec.get(),
                    c.caveBlindfishFakeOutChance.get(),
                    c.caveBlindfishFatigueThreshold.get(),
                    c.caveBlindfishFatigueDurationSec.get(),
                    c.caveBlindfishStaminaRegen.get()));

            next.put("north_african_catfish", new Values(
                    c.northAfricanCatfishMinKg.get(),
                    c.northAfricanCatfishMaxKg.get(),
                    c.northAfricanCatfishPullSpeed.get(),
                    c.northAfricanCatfishFatiguedPullSpeed.get(),
                    c.northAfricanCatfishStamina.get(),
                    c.northAfricanCatfishTensionGain.get(),
                    c.northAfricanCatfishSprintDurationSec.get(),
                    c.northAfricanCatfishSprintIntervalSec.get(),
                    c.northAfricanCatfishTurnIntervalSec.get(),
                    c.northAfricanCatfishFakeOutChance.get(),
                    c.northAfricanCatfishFatigueThreshold.get(),
                    c.northAfricanCatfishFatigueDurationSec.get(),
                    c.northAfricanCatfishStaminaRegen.get()));

            next.put("rainbow_trout", new Values(
                    c.rainbowTroutMinKg.get(),
                    c.rainbowTroutMaxKg.get(),
                    c.rainbowTroutPullSpeed.get(),
                    c.rainbowTroutFatiguedPullSpeed.get(),
                    c.rainbowTroutStamina.get(),
                    c.rainbowTroutTensionGain.get(),
                    c.rainbowTroutSprintDurationSec.get(),
                    c.rainbowTroutSprintIntervalSec.get(),
                    c.rainbowTroutTurnIntervalSec.get(),
                    c.rainbowTroutFakeOutChance.get(),
                    c.rainbowTroutFatigueThreshold.get(),
                    c.rainbowTroutFatigueDurationSec.get(),
                    c.rainbowTroutStaminaRegen.get()));

            next.put("arctic_char", new Values(
                    c.arcticCharMinKg.get(),
                    c.arcticCharMaxKg.get(),
                    c.arcticCharPullSpeed.get(),
                    c.arcticCharFatiguedPullSpeed.get(),
                    c.arcticCharStamina.get(),
                    c.arcticCharTensionGain.get(),
                    c.arcticCharSprintDurationSec.get(),
                    c.arcticCharSprintIntervalSec.get(),
                    c.arcticCharTurnIntervalSec.get(),
                    c.arcticCharFakeOutChance.get(),
                    c.arcticCharFatigueThreshold.get(),
                    c.arcticCharFatigueDurationSec.get(),
                    c.arcticCharStaminaRegen.get()));

            next.put("burbot", new Values(
                    c.burbotMinKg.get(),
                    c.burbotMaxKg.get(),
                    c.burbotPullSpeed.get(),
                    c.burbotFatiguedPullSpeed.get(),
                    c.burbotStamina.get(),
                    c.burbotTensionGain.get(),
                    c.burbotSprintDurationSec.get(),
                    c.burbotSprintIntervalSec.get(),
                    c.burbotTurnIntervalSec.get(),
                    c.burbotFakeOutChance.get(),
                    c.burbotFatigueThreshold.get(),
                    c.burbotFatigueDurationSec.get(),
                    c.burbotStaminaRegen.get()));

            next.put("whitefish", new Values(
                    c.whitefishMinKg.get(),
                    c.whitefishMaxKg.get(),
                    c.whitefishPullSpeed.get(),
                    c.whitefishFatiguedPullSpeed.get(),
                    c.whitefishStamina.get(),
                    c.whitefishTensionGain.get(),
                    c.whitefishSprintDurationSec.get(),
                    c.whitefishSprintIntervalSec.get(),
                    c.whitefishTurnIntervalSec.get(),
                    c.whitefishFakeOutChance.get(),
                    c.whitefishFatigueThreshold.get(),
                    c.whitefishFatigueDurationSec.get(),
                    c.whitefishStaminaRegen.get()));

            next.put("taimen", new Values(
                    c.taimenMinKg.get(),
                    c.taimenMaxKg.get(),
                    c.taimenPullSpeed.get(),
                    c.taimenFatiguedPullSpeed.get(),
                    c.taimenStamina.get(),
                    c.taimenTensionGain.get(),
                    c.taimenSprintDurationSec.get(),
                    c.taimenSprintIntervalSec.get(),
                    c.taimenTurnIntervalSec.get(),
                    c.taimenFakeOutChance.get(),
                    c.taimenFatigueThreshold.get(),
                    c.taimenFatigueDurationSec.get(),
                    c.taimenStaminaRegen.get()));

            next.put("arctic_cod", new Values(
                    c.arcticCodMinKg.get(),
                    c.arcticCodMaxKg.get(),
                    c.arcticCodPullSpeed.get(),
                    c.arcticCodFatiguedPullSpeed.get(),
                    c.arcticCodStamina.get(),
                    c.arcticCodTensionGain.get(),
                    c.arcticCodSprintDurationSec.get(),
                    c.arcticCodSprintIntervalSec.get(),
                    c.arcticCodTurnIntervalSec.get(),
                    c.arcticCodFakeOutChance.get(),
                    c.arcticCodFatigueThreshold.get(),
                    c.arcticCodFatigueDurationSec.get(),
                    c.arcticCodStaminaRegen.get()));

            next.put("capelin", new Values(
                    c.capelinMinKg.get(),
                    c.capelinMaxKg.get(),
                    c.capelinPullSpeed.get(),
                    c.capelinFatiguedPullSpeed.get(),
                    c.capelinStamina.get(),
                    c.capelinTensionGain.get(),
                    c.capelinSprintDurationSec.get(),
                    c.capelinSprintIntervalSec.get(),
                    c.capelinTurnIntervalSec.get(),
                    c.capelinFakeOutChance.get(),
                    c.capelinFatigueThreshold.get(),
                    c.capelinFatigueDurationSec.get(),
                    c.capelinStaminaRegen.get()));

            next.put("atlantic_herring", new Values(
                    c.atlanticHerringMinKg.get(),
                    c.atlanticHerringMaxKg.get(),
                    c.atlanticHerringPullSpeed.get(),
                    c.atlanticHerringFatiguedPullSpeed.get(),
                    c.atlanticHerringStamina.get(),
                    c.atlanticHerringTensionGain.get(),
                    c.atlanticHerringSprintDurationSec.get(),
                    c.atlanticHerringSprintIntervalSec.get(),
                    c.atlanticHerringTurnIntervalSec.get(),
                    c.atlanticHerringFakeOutChance.get(),
                    c.atlanticHerringFatigueThreshold.get(),
                    c.atlanticHerringFatigueDurationSec.get(),
                    c.atlanticHerringStaminaRegen.get()));

            next.put("wolffish", new Values(
                    c.wolffishMinKg.get(),
                    c.wolffishMaxKg.get(),
                    c.wolffishPullSpeed.get(),
                    c.wolffishFatiguedPullSpeed.get(),
                    c.wolffishStamina.get(),
                    c.wolffishTensionGain.get(),
                    c.wolffishSprintDurationSec.get(),
                    c.wolffishSprintIntervalSec.get(),
                    c.wolffishTurnIntervalSec.get(),
                    c.wolffishFakeOutChance.get(),
                    c.wolffishFatigueThreshold.get(),
                    c.wolffishFatigueDurationSec.get(),
                    c.wolffishStaminaRegen.get()));

            next.put("redfish", new Values(
                    c.redfishMinKg.get(),
                    c.redfishMaxKg.get(),
                    c.redfishPullSpeed.get(),
                    c.redfishFatiguedPullSpeed.get(),
                    c.redfishStamina.get(),
                    c.redfishTensionGain.get(),
                    c.redfishSprintDurationSec.get(),
                    c.redfishSprintIntervalSec.get(),
                    c.redfishTurnIntervalSec.get(),
                    c.redfishFakeOutChance.get(),
                    c.redfishFatigueThreshold.get(),
                    c.redfishFatigueDurationSec.get(),
                    c.redfishStaminaRegen.get()));

            next.put("sablefish", new Values(
                    c.sablefishMinKg.get(),
                    c.sablefishMaxKg.get(),
                    c.sablefishPullSpeed.get(),
                    c.sablefishFatiguedPullSpeed.get(),
                    c.sablefishStamina.get(),
                    c.sablefishTensionGain.get(),
                    c.sablefishSprintDurationSec.get(),
                    c.sablefishSprintIntervalSec.get(),
                    c.sablefishTurnIntervalSec.get(),
                    c.sablefishFakeOutChance.get(),
                    c.sablefishFatigueThreshold.get(),
                    c.sablefishFatigueDurationSec.get(),
                    c.sablefishStaminaRegen.get()));

            next.put("atlantic_cod", new Values(
                    c.atlanticCodMinKg.get(),
                    c.atlanticCodMaxKg.get(),
                    c.atlanticCodPullSpeed.get(),
                    c.atlanticCodFatiguedPullSpeed.get(),
                    c.atlanticCodStamina.get(),
                    c.atlanticCodTensionGain.get(),
                    c.atlanticCodSprintDurationSec.get(),
                    c.atlanticCodSprintIntervalSec.get(),
                    c.atlanticCodTurnIntervalSec.get(),
                    c.atlanticCodFakeOutChance.get(),
                    c.atlanticCodFatigueThreshold.get(),
                    c.atlanticCodFatigueDurationSec.get(),
                    c.atlanticCodStaminaRegen.get()));

            next.put("greenland_halibut", new Values(
                    c.greenlandHalibutMinKg.get(),
                    c.greenlandHalibutMaxKg.get(),
                    c.greenlandHalibutPullSpeed.get(),
                    c.greenlandHalibutFatiguedPullSpeed.get(),
                    c.greenlandHalibutStamina.get(),
                    c.greenlandHalibutTensionGain.get(),
                    c.greenlandHalibutSprintDurationSec.get(),
                    c.greenlandHalibutSprintIntervalSec.get(),
                    c.greenlandHalibutTurnIntervalSec.get(),
                    c.greenlandHalibutFakeOutChance.get(),
                    c.greenlandHalibutFatigueThreshold.get(),
                    c.greenlandHalibutFatigueDurationSec.get(),
                    c.greenlandHalibutStaminaRegen.get()));

            next.put("greenland_shark", new Values(
                    c.greenlandSharkMinKg.get(),
                    c.greenlandSharkMaxKg.get(),
                    c.greenlandSharkPullSpeed.get(),
                    c.greenlandSharkFatiguedPullSpeed.get(),
                    c.greenlandSharkStamina.get(),
                    c.greenlandSharkTensionGain.get(),
                    c.greenlandSharkSprintDurationSec.get(),
                    c.greenlandSharkSprintIntervalSec.get(),
                    c.greenlandSharkTurnIntervalSec.get(),
                    c.greenlandSharkFakeOutChance.get(),
                    c.greenlandSharkFatigueThreshold.get(),
                    c.greenlandSharkFatigueDurationSec.get(),
                    c.greenlandSharkStaminaRegen.get()));

            next.put("sailfish", new Values(
                    c.sailfishMinKg.get(),
                    c.sailfishMaxKg.get(),
                    c.sailfishPullSpeed.get(),
                    c.sailfishFatiguedPullSpeed.get(),
                    c.sailfishStamina.get(),
                    c.sailfishTensionGain.get(),
                    c.sailfishSprintDurationSec.get(),
                    c.sailfishSprintIntervalSec.get(),
                    c.sailfishTurnIntervalSec.get(),
                    c.sailfishFakeOutChance.get(),
                    c.sailfishFatigueThreshold.get(),
                    c.sailfishFatigueDurationSec.get(),
                    c.sailfishStaminaRegen.get()));

            next.put("mahi_mahi", new Values(
                    c.mahiMahiMinKg.get(),
                    c.mahiMahiMaxKg.get(),
                    c.mahiMahiPullSpeed.get(),
                    c.mahiMahiFatiguedPullSpeed.get(),
                    c.mahiMahiStamina.get(),
                    c.mahiMahiTensionGain.get(),
                    c.mahiMahiSprintDurationSec.get(),
                    c.mahiMahiSprintIntervalSec.get(),
                    c.mahiMahiTurnIntervalSec.get(),
                    c.mahiMahiFakeOutChance.get(),
                    c.mahiMahiFatigueThreshold.get(),
                    c.mahiMahiFatigueDurationSec.get(),
                    c.mahiMahiStaminaRegen.get()));

            next.put("alligator_gar", new Values(
                    c.alligatorGarMinKg.get(),
                    c.alligatorGarMaxKg.get(),
                    c.alligatorGarPullSpeed.get(),
                    c.alligatorGarFatiguedPullSpeed.get(),
                    c.alligatorGarStamina.get(),
                    c.alligatorGarTensionGain.get(),
                    c.alligatorGarSprintDurationSec.get(),
                    c.alligatorGarSprintIntervalSec.get(),
                    c.alligatorGarTurnIntervalSec.get(),
                    c.alligatorGarFakeOutChance.get(),
                    c.alligatorGarFatigueThreshold.get(),
                    c.alligatorGarFatigueDurationSec.get(),
                    c.alligatorGarStaminaRegen.get()));

            next.put("giant_siamese_carp", new Values(
                    c.giantSiameseCarpMinKg.get(),
                    c.giantSiameseCarpMaxKg.get(),
                    c.giantSiameseCarpPullSpeed.get(),
                    c.giantSiameseCarpFatiguedPullSpeed.get(),
                    c.giantSiameseCarpStamina.get(),
                    c.giantSiameseCarpTensionGain.get(),
                    c.giantSiameseCarpSprintDurationSec.get(),
                    c.giantSiameseCarpSprintIntervalSec.get(),
                    c.giantSiameseCarpTurnIntervalSec.get(),
                    c.giantSiameseCarpFakeOutChance.get(),
                    c.giantSiameseCarpFatigueThreshold.get(),
                    c.giantSiameseCarpFatigueDurationSec.get(),
                    c.giantSiameseCarpStaminaRegen.get()));

            next.put("electric_eel", new Values(
                    c.electricEelMinKg.get(),
                    c.electricEelMaxKg.get(),
                    c.electricEelPullSpeed.get(),
                    c.electricEelFatiguedPullSpeed.get(),
                    c.electricEelStamina.get(),
                    c.electricEelTensionGain.get(),
                    c.electricEelSprintDurationSec.get(),
                    c.electricEelSprintIntervalSec.get(),
                    c.electricEelTurnIntervalSec.get(),
                    c.electricEelFakeOutChance.get(),
                    c.electricEelFatigueThreshold.get(),
                    c.electricEelFatigueDurationSec.get(),
                    c.electricEelStaminaRegen.get()));
            // ==== END 生成区 ====
            VALUES.clear();
            VALUES.putAll(next);
            loadedOnce = true;
            if (next.size() != FishSpecies.ALL.size()) {
                // 少了就说明"配置项与鱼种表对不上"，比如新增了鱼种却忘了重新生成。
                // 不抛异常（那样会连累整个配置热重载），但必须留下明确日志。
                AnglersTackle.LOGGER.warn("[垂纶] 鱼种数值装载 {} 条，但鱼种表有 {} 条 —— " +
                        "跑一下 tools/gen-fish-config.js 重新生成",
                        next.size(), FishSpecies.ALL.size());
            }
            AnglersTackle.LOGGER.info("[垂纶] 鱼种数值已装载：{} 条", next.size());
        } catch (Throwable t) {
            // 配置还没加载完（构造/注册阶段）或读取出错：保留上一次的值。
            // 首次构建失败时 VALUES 为空，getter 会走兜底。
            AnglersTackle.LOGGER.warn("[垂纶] 鱼种数值装载失败（先用兜底值）：{}", t.toString());
        }
    }

    /**
     * 是否已经成功装载过一次。
     *
     * <p>这个标志是为了**让"没装载"不可能静默**：装载失败时 {@link #get} 会走兜底，
     * 而兜底值看起来是"一条正常但很温和的鱼"，玩家只会觉得"手感软"，
     * 完全联想不到是配置没读到。所以只要没装载过，每次取值都记一条 WARN。
     * （真实事故：build() 忘了在启动路径调用，所有鱼都用手感兜底值，
     *   排查了很久才想到"是不是压根没装载"。）
     */
    private static volatile boolean loadedOnce = false;

    /** 兜底告警只打前几次，避免刷屏。 */
    private static final java.util.concurrent.atomic.AtomicInteger fallbackWarns =
            new java.util.concurrent.atomic.AtomicInteger();

    private static Values get(String id) {
        Values v = VALUES.get(id);
        if (v != null) {
            return v;
        }
        if (!loadedOnce && fallbackWarns.getAndIncrement() < 3) {
            AnglersTackle.LOGGER.warn("[垂纶] 鱼种数值尚未装载，正在用兜底值（鲫鱼档）—— 取的是 {}。" +
                    " 若所有鱼手感都一样软，问题就在这里：检查 AnglersTackle 是否监听了" +
                    " ModConfigEvent 并调用了 FishTuning.build()", id);
        }
        Values f = VALUES.get("crucian_carp");
        if (f != null) {
            return f;
        }
        // 完全没装载过：用 FightProfile.CRUCIAN_CARP 的字面数值兜底
        return new Values(0.10, 1.20,
                FALLBACK.pullSpeed(), FALLBACK.fatiguedPullSpeed(), FALLBACK.stamina(),
                FALLBACK.tensionGain(),
                FALLBACK.sprintDurationSec(), FALLBACK.sprintIntervalSec(), FALLBACK.turnIntervalSec(),
                FALLBACK.fakeOutChance(), FALLBACK.fatigueThreshold(),
                FALLBACK.fatigueDurationSec(), FALLBACK.staminaRegen());
    }

    // ================================================================ 单值读取

    public static double minKg(String id) {
        return get(id).minKg();
    }

    public static double maxKg(String id) {
        return get(id).maxKg();
    }

    public static double pullSpeed(String id) {
        return get(id).pullSpeed();
    }

    public static double stamina(String id) {
        return get(id).stamina();
    }

    public static double tensionGain(String id) {
        return get(id).tensionGain();
    }

    /**
     * 这条鱼的手感档案（每次新建，理由见类文档）。
     *
     * @param id        鱼种 id
     * @param archetype 原型来自鱼种表 —— 它是"行为类别"而不是数值，不做成配置项
     */
    public static FightProfile profile(String id, FightProfile.Archetype archetype) {
        return get(id).toProfile(archetype);
    }

    /** 装载完成的鱼种数量（供自检与指令显示）。 */
    public static int loadedCount() {
        return VALUES.size();
    }

    /** 某个 id 是否有运行期数值（供自检用）。 */
    public static boolean has(String id) {
        return VALUES.containsKey(id);
    }
}
