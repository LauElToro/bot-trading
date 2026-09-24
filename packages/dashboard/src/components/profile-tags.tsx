export function formatPublicHandle(name: string, tags?: string[] | null): string {
  const tag = tags?.find((item) => item.trim());
  return tag ? `${name}#${tag}` : name;
}

export function ProfileTags({
  name,
  tags,
  className = '',
  tagClassName = '',
}: {
  name: string;
  tags?: string[] | null;
  className?: string;
  tagClassName?: string;
}) {
  const tag = tags?.find((item) => item.trim());
  return (
    <span className={`flex min-w-0 max-w-full items-baseline ${className}`}>
      <span className="truncate">{name}</span>
      {tag ? (
        <span className={`shrink-0 font-mono tracking-wide text-primary ${tagClassName}`}>
          #{tag}
        </span>
      ) : null}
    </span>
  );
}
