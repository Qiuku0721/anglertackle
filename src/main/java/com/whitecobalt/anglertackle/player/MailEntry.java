package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.world.item.ItemStack;

import java.util.List;

/**
 * 一封邮件（用户 2026-10-11："点击邮件之中的签收按钮自动领取邮件奖励"，策划见 `docs/36`）。
 *
 * <h2>两条硬纪律（写在这里，别再犯错）</h2>
 * <ol>
 *   <li><b>"已读" ≠ "已领"</b> —— {@link #read} 与 {@link #claimed} 是**两个独立位**。
 *       把"点开就自动领"当省事方案，会让"玩家点开看了一眼、背包满、物品留在哪？"无解，
 *       而那正是用户明确要的签收按钮存在的理由 ✗；</li>
 *   <li><b>服务端只发 {@code template + args}，不拼中文</b> —— 服务端没有语言表
 *       （排行榜当初只能显示 {@code greenland_shark} 就是这个原因）。文案在语言文件里，
 *       客户端本地化 ⇒ 英文客户端不会看到中文 ✓。</li>
 * </ol>
 *
 * <p>⚠ {@code args} 里**不许塞写死的数字**：名次、数量、时刻都由参数传（本仓库在"手册数字"
 * 上已经踩过好几次"改配置不改文案"）。
 *
 * @param id       收件人自己的序号（界面/网络包只用它；不用 UUID 是为了可读、可查日志）
 * @param template 模板 id（如 {@code admin} / {@code league_invite}）—— 语言键是
 *                 {@code mail.anglertackle.<template>.title|body|button}
 * @param args     模板参数
 * @param sentAt   收到的**现实时刻**（毫秒）—— 界面要显示"3 天前"，现实时刻最直观
 * @param read     读过没有（**与 {@link #claimed} 无关**）
 * @param claimed  附件领过没有；没有附件**也没有动作按钮**的邮件恒为 true
 *                 （有动作 = 动作还没执行过，初始为 false，按钮才是可点的）
 * @param coins    附件：鱼币（0 = 没有）
 * @param items    附件：物品（可为空；最多 4 格 —— 界面放不下，也没必要）
 * @param action   可选的动作按钮 id（如 {@code league_join}；空 = 没有按钮）。
 *                 ⚠ 服务端只认白名单 id，客户端不能自己定义动作、也不能指定"替谁执行"
 */
public record MailEntry(
        int id,
        String template,
        List<String> args,
        long sentAt,
        boolean read,
        boolean claimed,
        long coins,
        List<ItemStack> items,
        String action) {

    /** 附件最多 4 格（`docs/36` §2.1）。 */
    public static final int MAX_ATTACHMENT_SLOTS = 4;

    public static final Codec<MailEntry> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.INT.fieldOf("id").forGetter(MailEntry::id),
            Codec.STRING.optionalFieldOf("template", "admin").forGetter(MailEntry::template),
            Codec.STRING.listOf().optionalFieldOf("args", List.of()).forGetter(MailEntry::args),
            Codec.LONG.optionalFieldOf("sent_at", 0L).forGetter(MailEntry::sentAt),
            Codec.BOOL.optionalFieldOf("read", false).forGetter(MailEntry::read),
            Codec.BOOL.optionalFieldOf("claimed", true).forGetter(MailEntry::claimed),
            Codec.LONG.optionalFieldOf("coins", 0L).forGetter(MailEntry::coins),
            // ⚠ 必须用 OPTIONAL_CODEC：附件（玩家 NBT）的持久化路径拿不到 registry ops，
            //   用 ItemStack.CODEC（RegistryFriendlyCodec）会在读档时抛 "Can't access registry"
            //   —— 这个坑记在 ModDataComponents.RodParts.PART_CODEC 的注释里 ✓
            ItemStack.OPTIONAL_CODEC.listOf().optionalFieldOf("items", List.of())
                    .forGetter(MailEntry::items),
            Codec.STRING.optionalFieldOf("action", "").forGetter(MailEntry::action)
    ).apply(inst, MailEntry::new));

    /** 还没有读过。 */
    public boolean unread() {
        return !read;
    }

    /** 有东西可领（没被领过、还有附件）。 */
    public boolean claimable() {
        return !claimed && (coins > 0L || !items.isEmpty());
    }

    /** 有没有附件（不管领没领过）—— 界面用它决定要不要画附件格。 */
    public boolean hasAttachment() {
        return coins > 0L || !items.isEmpty();
    }

    /** 标记已读（**不动 claimed**）。 */
    public MailEntry withRead() {
        return read ? this : new MailEntry(id, template, args, sentAt, true, claimed, coins, items, action);
    }

    /**
     * 标记**未读**（**不动 claimed**）—— {@link #withRead()} 的反向操作。
     *
     * <p>只有一个用途：新手礼包那封没领的时候重新标成未读，让"未读提示"再提一次
     * （见 {@code MailBox.withKitUnread}）。别拿它当通用工具：把玩家看过的信改回未读，
     * 他只会在打开邮箱时觉得"这封我明明看过了"。
     */
    public MailEntry withUnread() {
        return !read ? this : new MailEntry(id, template, args, sentAt, false, claimed, coins, items, action);
    }

    /**
     * 领取完成：清掉附件并置 {@code claimed = true}。
     *
     * <p>为什么连附件一起清：领完还留着 `coins=50` 的话，界面会显示"有 50 币"而实际已经进钱包了 ——
     * 玩家看到的就是"这封信还有钱"。清了才是"这封信说的事已经办完"。
     */
    public MailEntry withClaimed() {
        return new MailEntry(id, template, args, sentAt, true, true, 0L, List.of(), action);
    }

    /**
     * 超保管期：**只作废附件、正文保留**（`docs/36` §3 纪律 3）。
     *
     * <p>30 天没领的东西作废，但"这封信说过什么"留在记录里 —— 否则玩家会觉得"我的邮件被人删了"。
     */
    public MailEntry withVoidedAttachments() {
        return hasAttachment() || !claimed
                ? new MailEntry(id, template, args, sentAt, read, true, 0L, List.of(), action)
                : this;
    }

    /** 有没有动作按钮。 */
    public boolean hasAction() {
        return action != null && !action.isEmpty();
    }

    /**
     * 换上动作按钮（**升级 1.6.2 旧信用**，见 {@code QuestService.upgradeLegacyLetters}）。
     *
     * <p>同时把 {@code claimed} 打回 {@code false}：动作还没执行过，就不能算"已办完"
     * —— 否则界面上的按钮是灰的，玩家点了没反应（2026-10-14 验收实测 ✗）。
     */
    public MailEntry withAction(String action) {
        return action == null || action.isEmpty()
                ? this
                : new MailEntry(id, template, args, sentAt, read, false, coins, items, action);
    }
}
