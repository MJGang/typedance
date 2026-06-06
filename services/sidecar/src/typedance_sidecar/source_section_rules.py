SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (
        ("核心能力", "专业技能", "相关技能", "技能", "技能清单", "职业技能"),
        "CoreSkills",
        "专业技能",
    ),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]
