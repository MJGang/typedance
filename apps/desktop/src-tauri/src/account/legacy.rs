use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

use super::{file_count, import_claim, legacy_entries, plain_directory};

#[derive(Clone, Serialize)]
pub(super) struct LegacySource {
    pub(super) id: String,
    pub(super) path: String,
    pub(super) file_count: usize,
}

#[derive(Clone, Serialize)]
pub(super) struct LegacySummary {
    pub(super) sources: Vec<LegacySource>,
    pub(super) import_started: bool,
}

pub(super) struct LegacyCandidate {
    pub(super) root: PathBuf,
    pub(super) info: LegacySource,
    import_started: bool,
}

impl LegacySummary {
    pub(super) fn ensure_skip_allowed(&self) -> Result<(), String> {
        if self.import_started {
            return Err(
                "历史数据已开始导入，请重试完成导入；已复制的数据和原数据均已保留。".into(),
            );
        }
        Ok(())
    }
}

pub(super) fn summarize(candidates: Vec<LegacyCandidate>) -> Option<LegacySummary> {
    if candidates.is_empty() {
        return None;
    }
    Some(LegacySummary {
        import_started: candidates.iter().any(|source| source.import_started),
        sources: candidates.into_iter().map(|source| source.info).collect(),
    })
}

pub(super) fn discover(roots: Vec<PathBuf>, profile: &str) -> Result<Vec<LegacyCandidate>, String> {
    let mut candidates: Vec<LegacyCandidate> = Vec::new();
    for root in roots {
        let entries = legacy_entries(&root);
        if entries.is_empty() {
            continue;
        }
        if !root.is_absolute() {
            return Err("历史数据目录必须是绝对路径。".into());
        }
        plain_directory(&root)?;
        let owner = import_claim::owner(&root)?;
        if owner.as_deref().is_some_and(|owner| owner != profile) {
            continue;
        }
        let canonical = fs::canonicalize(&root).map_err(|_| "无法确认历史数据目录。")?;
        let id = format!(
            "{:x}",
            Sha256::digest(canonical.as_os_str().to_string_lossy().as_bytes())
        );
        if candidates.iter().any(|source| source.info.id == id) {
            continue;
        }
        let info = LegacySource {
            id,
            path: root.to_string_lossy().into_owned(),
            file_count: entries
                .iter()
                .map(|entry| file_count(&root.join(entry)))
                .sum(),
        };
        candidates.push(LegacyCandidate {
            root,
            info,
            import_started: owner.is_some(),
        });
    }
    let active = candidates
        .iter()
        .filter(|source| source.import_started)
        .count();
    if active > 1 {
        return Err("检测到多份由当前账号认领的未完成导入，请保留数据并修复归属记录。".into());
    }
    if active == 1 {
        candidates.retain(|source| source.import_started);
    }
    Ok(candidates)
}

pub(super) fn select(
    candidates: Vec<LegacyCandidate>,
    source_id: &str,
) -> Result<LegacyCandidate, String> {
    candidates
        .into_iter()
        .find(|source| source.info.id == source_id)
        .ok_or_else(|| "所选历史数据已不可用，请重新登录后重试，或暂不导入。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(parent: &std::path::Path, name: &str) -> PathBuf {
        let root = parent.join(name);
        fs::create_dir(&root).unwrap();
        fs::write(root.join("typedance.sqlite"), b"preserved source").unwrap();
        root
    }

    #[test]
    fn multiple_sources_are_offered_without_claiming_or_merging_them() {
        let temporary = tempfile::tempdir().unwrap();
        let first = source(temporary.path(), "installed");
        let second = source(temporary.path(), "home");
        let roots = vec![first.clone(), second.clone(), first.clone()];
        let candidates = discover(roots.clone(), "account-a").unwrap();
        assert_eq!(candidates.len(), 2);
        assert!(candidates
            .iter()
            .all(|candidate| candidate.info.file_count == 1));
        let selected = candidates[1].info.id.clone();
        assert_eq!(select(candidates, &selected).unwrap().root, second);
        assert!(select(discover(roots, "account-a").unwrap(), "arbitrary-path").is_err());
        assert!(import_claim::available(&first, "account-b").unwrap());
        assert!(import_claim::available(&second, "account-b").unwrap());
        assert_eq!(
            fs::read(first.join("typedance.sqlite")).unwrap(),
            b"preserved source"
        );
    }

    #[test]
    fn import_selection_rechecks_ownership_and_rejects_a_stale_source() {
        let temporary = tempfile::tempdir().unwrap();
        let first = source(temporary.path(), "installed");
        let second = source(temporary.path(), "home");
        let roots = vec![first.clone(), second.clone()];
        let candidates = discover(roots.clone(), "account-a").unwrap();
        let selected = candidates[0].info.id.clone();
        import_claim::reserve(&first, "account-b").unwrap();
        let candidates = discover(roots, "account-a").unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].root, second);
        assert!(select(candidates, &selected).is_err());
    }

    #[test]
    fn interrupted_import_pins_its_source_and_blocks_skipping_partial_data() {
        let temporary = tempfile::tempdir().unwrap();
        let first = source(temporary.path(), "installed");
        let second = source(temporary.path(), "home");
        let roots = vec![first.clone(), second.clone()];
        let original = discover(roots.clone(), "account-a").unwrap();
        let other_id = original[1].info.id.clone();
        assert!(summarize(original).unwrap().ensure_skip_allowed().is_ok());
        import_claim::reserve(&first, "account-a").unwrap();
        let resumed = discover(roots.clone(), "account-a").unwrap();
        assert_eq!(resumed.len(), 1);
        assert_eq!(resumed[0].root, first);
        assert!(select(resumed, &other_id).is_err());
        assert!(summarize(discover(roots, "account-a").unwrap())
            .unwrap()
            .ensure_skip_allowed()
            .is_err());
        assert!(import_claim::available(&second, "account-b").unwrap());
    }
}
